package expo.modules.ralphcall

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.util.Log

/**
 * The sounds a call makes outside a notification, main thread only.
 *
 * The ring while the app is in front (its sheet shows instead of a
 * notification, so no channel plays): the phone's ringtone, looping, and
 * the call vibration, as the system would for a notification on the calls
 * channel: nothing in Do Not Disturb, vibration only on vibrate, nothing on
 * silent.
 *
 * The ringback the caller hears while the other phone rings.
 */
internal object Ringer {
  private const val TAG = "RalphCall"
  private val PATTERN = longArrayOf(0, 800, 800)

  private var ringtone: Ringtone? = null
  private var vibrator: Vibrator? = null
  private var ringback: ToneGenerator? = null

  fun startRing(context: Context) {
    stopRing()
    val notifications = context.getSystemService(NotificationManager::class.java)
    if (notifications != null &&
      notifications.currentInterruptionFilter > NotificationManager.INTERRUPTION_FILTER_ALL
    ) {
      return
    }
    val audio = context.getSystemService(AudioManager::class.java) ?: return
    when (audio.ringerMode) {
      AudioManager.RINGER_MODE_NORMAL -> {
        playRingtone(context)
        vibrate(context)
      }
      AudioManager.RINGER_MODE_VIBRATE -> vibrate(context)
      else -> Unit
    }
  }

  fun stopRing() {
    ringtone?.stop()
    ringtone = null
    vibrator?.cancel()
    vibrator = null
  }

  fun setRingback(on: Boolean) {
    if (!on) {
      ringback?.stopTone()
      ringback?.release()
      ringback = null
      return
    }
    if (ringback != null) return
    ringback =
      try {
        ToneGenerator(AudioManager.STREAM_VOICE_CALL, 80).also {
          it.startTone(ToneGenerator.TONE_SUP_RINGTONE)
        }
      } catch (error: RuntimeException) {
        Log.w(TAG, "No ringback tone", error)
        null
      }
  }

  private fun playRingtone(context: Context) {
    val uri =
      RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE)
        ?: Settings.System.DEFAULT_RINGTONE_URI
    val tone = RingtoneManager.getRingtone(context, uri) ?: return
    tone.audioAttributes =
      AudioAttributes
        .Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) tone.isLooping = true
    try {
      tone.play()
      ringtone = tone
    } catch (error: RuntimeException) {
      Log.w(TAG, "Could not play the ringtone", error)
    }
  }

  private fun vibrate(context: Context) {
    val device =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.getSystemService(VibratorManager::class.java)?.defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Vibrator::class.java)
      } ?: return
    if (!device.hasVibrator()) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      device.vibrate(VibrationEffect.createWaveform(PATTERN, 0))
    } else {
      @Suppress("DEPRECATION")
      device.vibrate(PATTERN, 0)
    }
    vibrator = device
  }
}
