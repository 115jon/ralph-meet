package expo.modules.ralphcall

import android.content.Context
import android.net.Uri
import android.os.Build
import android.telecom.DisconnectCause
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.telecom.CallAttributesCompat
import androidx.core.telecom.CallControlResult
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallEndpointCompat
import androidx.core.telecom.CallsManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

private const val TAG = "RalphCall"

/**
 * The call registered with the system as a self-managed VoIP call through
 * androidx.core.telecom. Telecom then owns call audio: it sets the
 * communication audio mode, holds audio focus, routes to earpiece, speaker,
 * wired or Bluetooth headsets, and shows the call to cars and watches.
 *
 * Telecom on API 34+ (platform call control) and a ConnectionService shim on
 * 26..33 are both handled inside core-telecom; below 26 there is no Telecom
 * for VoIP apps and [CallController] uses [LegacyAudioRouter].
 */
@RequiresApi(Build.VERSION_CODES.O)
internal class TelecomCall(
  context: Context,
  private val scope: CoroutineScope,
  private val events: Events,
) : AudioRouter {
  interface Events {
    fun onRoutesChanged()

    /** Telecom ended the call (another call, a car, a watch). */
    fun onSystemDisconnect(reason: String)

    /** The system's mute (car or watch button) moved. */
    fun onSystemMute(muted: Boolean)

    /** Telecom refused or dropped the call before it was set up. */
    fun onFailed(error: Throwable)
  }

  private val callsManager = CallsManager(context)
  private val control = CompletableDeferred<CallControlScope>()
  private var job: Job? = null
  private var endpoints: List<CallEndpointCompat> = emptyList()
  private var current: CallEndpointCompat? = null
  private var defaultRouteChosen = false
  private var ended = false

  override val state: RouteState
    get() =
      RouteState(
        endpoints.mapNotNull { it.toRoute() },
        current?.identifier?.toString(),
      )

  /** Throws when the device has no Telecom (some tablets, old builds). */
  fun start(displayName: String) {
    callsManager.registerAppWithTelecom(CallsManager.CAPABILITY_BASELINE)
    val attributes =
      CallAttributesCompat(
        displayName = displayName,
        address = Uri.parse("ralphmeet:voice-channel"),
        direction = CallAttributesCompat.DIRECTION_OUTGOING,
        callType = CallAttributesCompat.CALL_TYPE_AUDIO_CALL,
        // No hold: a voice channel cannot be parked, so Telecom ends it
        // instead when the user answers another call.
        callCapabilities = 0,
      )
    job =
      scope.launch {
        try {
          callsManager.addCall(
            attributes,
            onAnswer = {},
            onDisconnect = { cause -> systemDisconnected(cause) },
            onSetActive = {},
            onSetInactive = {},
          ) {
            control.complete(this)
            // Each flow needs its own coroutine or only the first is collected.
            launch {
              val result = setActive()
              if (result is CallControlResult.Error) {
                Log.w(TAG, "Telecom did not set the call active: ${result.errorCode}")
              }
            }
            launch {
              availableEndpoints.collect {
                endpoints = it
                chooseDefaultRoute()
                events.onRoutesChanged()
              }
            }
            launch {
              currentCallEndpoint.collect {
                current = it
                events.onRoutesChanged()
              }
            }
            launch {
              // The first value is the state at the start, not a press.
              isMuted.distinctUntilChanged().drop(1).collect { events.onSystemMute(it) }
            }
          }
        } catch (error: CancellationException) {
          throw error
        } catch (error: Exception) {
          Log.w(TAG, "Telecom call failed", error)
          if (!ended) events.onFailed(error)
        }
      }
  }

  override fun select(id: String): Boolean {
    val endpoint = endpoints.firstOrNull { it.identifier.toString() == id } ?: return false
    scope.launch {
      val result = control.await().requestEndpointChange(endpoint)
      if (result is CallControlResult.Error) {
        Log.w(TAG, "Endpoint change refused: ${result.errorCode}")
      }
    }
    return true
  }

  override fun stop() {
    if (ended) return
    ended = true
    val running = job
    scope.launch {
      // A call still being added gets a moment to arrive so it can be
      // disconnected rather than left behind in Telecom.
      val call = withTimeoutOrNull(5_000) { control.await() }
      try {
        call?.disconnect(DisconnectCause(DisconnectCause.LOCAL))
      } catch (error: Exception) {
        Log.w(TAG, "Telecom disconnect failed", error)
      }
      running?.cancel()
    }
  }

  private fun systemDisconnected(cause: DisconnectCause) {
    if (ended) return
    ended = true
    events.onSystemDisconnect(cause.reason ?: describe(cause.code))
  }

  /**
   * Voice channels are speaker-first, like the web app on a laptop, unless a
   * headset is plugged in or paired: then Telecom has already picked it.
   */
  private suspend fun chooseDefaultRoute() {
    if (defaultRouteChosen || endpoints.isEmpty()) return
    defaultRouteChosen = true
    val headset =
      endpoints.any {
        it.type == CallEndpointCompat.TYPE_BLUETOOTH || it.type == CallEndpointCompat.TYPE_WIRED_HEADSET
      }
    if (headset) return
    val speaker = endpoints.firstOrNull { it.type == CallEndpointCompat.TYPE_SPEAKER } ?: return
    control.await().requestEndpointChange(speaker)
  }
}

private fun describe(code: Int): String =
  when (code) {
    DisconnectCause.LOCAL -> "local"
    DisconnectCause.REMOTE -> "remote"
    DisconnectCause.BUSY -> "busy"
    DisconnectCause.REJECTED -> "rejected"
    DisconnectCause.ERROR -> "error"
    else -> "other"
  }

private fun CallEndpointCompat.toRoute(): AudioRoute? {
  val type =
    when (type) {
      CallEndpointCompat.TYPE_SPEAKER -> "speaker"
      CallEndpointCompat.TYPE_EARPIECE -> "earpiece"
      CallEndpointCompat.TYPE_BLUETOOTH -> "bluetooth"
      CallEndpointCompat.TYPE_WIRED_HEADSET -> "wired"
      // Streaming hands the call to another device; not a route to pick here.
      CallEndpointCompat.TYPE_STREAMING -> return null
      else -> "unknown"
    }
  return AudioRoute(identifier.toString(), type, name.toString())
}
