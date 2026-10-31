package expo.modules.ralphcall

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi

/**
 * Call audio without Telecom (Android 7.x, or a device without Telecom):
 * communication mode, audio focus and routing through AudioManager. On 12+
 * routes are the system's communication devices, Bluetooth included; below
 * that only speaker and earpiece (a wired headset takes over the earpiece).
 */
internal class LegacyAudioRouter(
  context: Context,
  private val speakerFirst: Boolean,
  private val onRoutesChanged: () -> Unit,
) : AudioRouter {
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val main = Handler(Looper.getMainLooper())
  private val previousMode = audio.mode
  private var focusRequest: Any? = null
  private var deviceCallback: AudioDeviceCallback? = null
  private var deviceListener: Any? = null

  override val state: RouteState
    get() =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        communicationState()
      } else {
        RouteState(
          listOf(AudioRoute(EARPIECE, "earpiece", "Phone"), AudioRoute(SPEAKER, "speaker", "Speaker")),
          @Suppress("DEPRECATION") if (audio.isSpeakerphoneOn) SPEAKER else EARPIECE,
        )
      }

  fun start() {
    requestFocus()
    audio.mode = AudioManager.MODE_IN_COMMUNICATION
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      startCommunicationRouting()
    } else {
      @Suppress("DEPRECATION")
      audio.isSpeakerphoneOn = speakerFirst && !audio.isWiredHeadsetOn && !audio.isBluetoothA2dpOn
    }
    onRoutesChanged()
  }

  override fun select(id: String): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val device = audio.availableCommunicationDevices.firstOrNull { it.id.toString() == id } ?: return false
      return audio.setCommunicationDevice(device)
    }
    @Suppress("DEPRECATION")
    audio.isSpeakerphoneOn = id == SPEAKER
    onRoutesChanged()
    return true
  }

  override fun stop() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      stopCommunicationRouting()
    } else {
      @Suppress("DEPRECATION")
      audio.isSpeakerphoneOn = false
    }
    audio.mode = previousMode
    abandonFocus()
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun communicationState(): RouteState {
    val routes =
      audio.availableCommunicationDevices.mapNotNull { device ->
        val type = routeType(device.type) ?: return@mapNotNull null
        val name = if (type == "bluetooth") device.productName.toString() else type
        AudioRoute(device.id.toString(), type, name)
      }
    return RouteState(routes, audio.communicationDevice?.id?.toString())
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun startCommunicationRouting() {
    val devices = audio.availableCommunicationDevices
    val headset = devices.firstOrNull { routeType(it.type).let { t -> t == "bluetooth" || t == "wired" } }
    val builtIn = if (speakerFirst) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
    val fallback = devices.firstOrNull { it.type == builtIn }
    (headset ?: fallback)?.let { audio.setCommunicationDevice(it) }

    val listener = AudioManager.OnCommunicationDeviceChangedListener { onRoutesChanged() }
    audio.addOnCommunicationDeviceChangedListener({ main.post(it) }, listener)
    deviceListener = listener
    val callback =
      object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = onRoutesChanged()

        override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = onRoutesChanged()
      }
    audio.registerAudioDeviceCallback(callback, main)
    deviceCallback = callback
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun stopCommunicationRouting() {
    (deviceListener as? AudioManager.OnCommunicationDeviceChangedListener)?.let {
      audio.removeOnCommunicationDeviceChangedListener(it)
    }
    deviceCallback?.let { audio.unregisterAudioDeviceCallback(it) }
    audio.clearCommunicationDevice()
  }

  private fun requestFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request =
        AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build(),
          ).build()
      audio.requestAudioFocus(request)
      focusRequest = request
    } else {
      @Suppress("DEPRECATION")
      audio.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    }
  }

  private fun abandonFocus() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      (focusRequest as? AudioFocusRequest)?.let { audio.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      audio.abandonAudioFocus(null)
    }
  }

  private companion object {
    const val EARPIECE = "earpiece"
    const val SPEAKER = "speaker"

    fun routeType(type: Int): String? =
      when (type) {
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
        AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLE_HEADSET -> "bluetooth"
        AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_USB_HEADSET -> "wired"
        else -> null
      }
  }
}
