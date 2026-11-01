package expo.modules.ralphcall

import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

private const val TAG = "RalphCall"

/**
 * The one call in progress, shared by the module, the foreground service and
 * the notification actions. Main thread only.
 */
internal object CallController {
  interface Listener {
    /** mute | unmute | hangup, from the notification or the system. */
    fun onAction(action: String)

    fun onAudioRoutesChanged(state: RouteState)

    fun onCallEndedBySystem(reason: String)
  }

  var listener: Listener? = null

  var info: CallInfo? = null
    private set

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var router: AudioRouter? = null

  val routes: RouteState
    get() = router?.state ?: RouteState.EMPTY

  /** Starts the call, or updates it when one is already running. */
  fun start(context: Context, next: CallInfo) {
    val app = context.applicationContext
    if (info != null) {
      update(app, next)
      return
    }
    info = next
    CallNotification.ensureChannel(app)
    startService(app)
    router = startAudio(app, next)
  }

  fun update(context: Context, next: CallInfo) {
    val current = info ?: return
    info = next.copy(startedAt = current.startedAt)
    CallNotification.post(context.applicationContext, info ?: return)
  }

  fun end(context: Context) {
    if (info == null) return
    info = null
    router?.stop()
    router = null
    val app = context.applicationContext
    app.stopService(Intent(app, RalphCallService::class.java))
    CallNotification.cancel(app)
    listener?.onAudioRoutesChanged(RouteState.EMPTY)
  }

  fun selectRoute(id: String): Boolean = router?.select(id) ?: false

  /** A notification button. JS owns the call state, so it decides. */
  fun onNotificationAction(context: Context, action: String) {
    val current = info
    if (current == null) {
      // A notification left over from a call that is gone.
      CallNotification.cancel(context.applicationContext)
      return
    }
    val js = listener
    if (js != null) {
      js.onAction(action)
    } else if (action == CallNotification.ACTION_HANGUP) {
      // No JS to ask (the bundle is reloading): at least let the user out.
      end(context)
    }
  }

  /**
   * Must run while the app is visible: Android 12+ refuses to start
   * foreground services from the background, and 14+ also refuses the
   * microphone type unless the app could use the microphone right now.
   */
  private fun startService(context: Context) {
    try {
      ContextCompat.startForegroundService(context, Intent(context, RalphCallService::class.java))
    } catch (error: Exception) {
      // ForegroundServiceStartNotAllowedException (12+) or SecurityException:
      // the call still works while the app is in front.
      Log.w(TAG, "Could not start the call service", error)
    }
  }

  private fun startAudio(context: Context, call: CallInfo): AudioRouter {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val telecom = TelecomCall(context, scope, telecomEvents(context))
      try {
        telecom.start(call.channelName, call.speakerFirst)
        return telecom
      } catch (error: Exception) {
        // UnsupportedOperationException or SecurityException: no Telecom here.
        Log.w(TAG, "Telecom unavailable; routing audio directly", error)
      }
    }
    return legacyAudio(context, call.speakerFirst)
  }

  private fun legacyAudio(context: Context, speakerFirst: Boolean): AudioRouter =
    LegacyAudioRouter(context, speakerFirst) { emitRoutes() }.also { it.start() }

  private fun telecomEvents(context: Context) =
    object : TelecomCall.Events {
      override fun onRoutesChanged() = emitRoutes()

      override fun onSystemDisconnect(reason: String) {
        if (info == null) return
        val js = listener
        end(context)
        js?.onCallEndedBySystem(reason)
      }

      override fun onSystemMute(muted: Boolean) {
        val current = info ?: return
        if (current.muted != muted) {
          listener?.onAction(if (muted) CallNotification.ACTION_MUTE else CallNotification.ACTION_UNMUTE)
        }
      }

      override fun onFailed(error: Throwable) {
        // Telecom refused the call (e.g. busy with a cellular call that
        // cannot be held). Keep the voice channel and route audio directly.
        val current = info ?: return
        router = legacyAudio(context, current.speakerFirst)
      }
    }

  private fun emitRoutes() {
    listener?.onAudioRoutesChanged(routes)
  }
}
