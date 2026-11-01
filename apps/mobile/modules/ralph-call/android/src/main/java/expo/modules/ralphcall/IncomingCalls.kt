package expo.modules.ralphcall

import android.app.ActivityManager
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telecom.DisconnectCause
import android.util.Log
import expo.modules.ralphnotify.RalphApi
import expo.modules.ralphnotify.Session
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

private const val TAG = "RalphCall"

/**
 * The DM call ringing this phone, whichever way it arrived (a push with the
 * app killed, or the gateway through JS) and wherever it is answered (the
 * ringing screen, the notification, a headset or car through Telecom, the
 * app's sheet). Rings once per call id. Main thread inside; the entry
 * points may be called from any thread.
 *
 * In front (the app visible, the phone unlocked, JS listening) it only plays
 * the ringtone and asks JS to show its sheet; otherwise it posts the
 * incoming CallStyle notification with its full-screen intent. Either way
 * the call is registered with Telecom as incoming.
 *
 * Answer from outside the app tells the server (POST accept, natively, so a
 * caller stops hearing ringback while the app starts), opens the app over
 * the lock screen, and leaves the answered Telecom call for [CallController]
 * to adopt when JS joins. Decline tells the server from here. A missed ring
 * (timeout, the caller hung up) becomes a missed-call notification unless
 * the user was looking at it in the app.
 */
internal object IncomingCalls {
  interface Listener {
    /** Shown in the app: JS raises its sheet. */
    fun onIncomingCall(call: IncomingCall)

    fun onIncomingCallEnded(callId: String, reason: String)

    /** Answered outside the app: JS takes it with [takeAnswered] and joins. */
    fun onIncomingCallAnswered(call: IncomingCall)
  }

  @Volatile var listener: Listener? = null

  private class Ring(
    val call: IncomingCall,
    val inApp: Boolean,
    val avatar: Bitmap?,
    val telecom: TelecomCall?,
    val timeout: Runnable,
  )

  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

  private var ring: Ring? = null

  /** Calls already rung and settled, so a late push or event cannot ring again. */
  private val settled = LinkedHashMap<String, Long>()
  private const val SETTLED_MEMORY_MS = 5 * 60_000L

  /** Answered outside the app, until JS takes it. */
  private var answered: IncomingCall? = null

  /** The answered Telecom call, until the call service adopts it. */
  private var answeredTelecom: Pair<String, TelecomCall>? = null
  private var dropAnsweredTelecom: Runnable? = null
  private const val ADOPT_WITHIN_MS = 60_000L

  /** The ringing screen on display, so the ring's end can close it. */
  var screen: IncomingCallActivity? = null

  val current: IncomingCall? get() = ring?.call

  val currentAvatar: Bitmap? get() = ring?.avatar

  // ── Entry points ─────────────────────────────────────────────────────────

  /**
   * Rings for `call`; fetches the caller's avatar off the main thread
   * first. `then` runs once the ring is up (or refused), for goAsync.
   */
  fun ring(
    context: Context,
    call: IncomingCall,
    then: (() -> Unit)? = null,
  ) {
    val app = context.applicationContext
    io.execute {
      val session = Session.load(app)
      if (session == null) {
        then?.invoke()
        return@execute
      }
      val avatar = call.callerAvatar?.let { RalphApi.avatar(session, it) }
      main.post {
        try {
          start(app, call, avatar)
        } finally {
          then?.invoke()
        }
      }
    }
  }

  /** A CALL_RING_STOP or `call_ring_stop` push; `caller` describes it for a missed call. */
  fun stop(
    context: Context,
    callId: String,
    reason: String,
    caller: IncomingCall? = null,
  ) {
    val app = context.applicationContext
    main.post { finish(app, callId, reason, caller) }
  }

  /** Answer. `fromApp`: the app's own sheet, which tells the server itself. */
  fun answer(
    context: Context,
    callId: String,
    fromApp: Boolean,
  ) {
    val app = context.applicationContext
    main.post { answerOnMain(app, callId, fromApp) }
  }

  /** Decline, from anywhere; tells the server from here. */
  fun decline(
    context: Context,
    callId: String,
    then: (() -> Unit)? = null,
  ) {
    val app = context.applicationContext
    main.post {
      tearDown(app, callId, "declined", DisconnectCause.REJECTED)
      markSettled(callId)
      tellServer(app, callId, "decline", then)
    }
  }

  /** The call JS should join now, once. */
  fun takeAnswered(): IncomingCall? = answered.also { answered = null }

  /** For [CallController]: the answered Telecom call of `callId`, once. */
  fun adoptTelecom(callId: String?): TelecomCall? {
    val (id, telecom) = answeredTelecom ?: return null
    if (callId != null && callId != id) return null
    answeredTelecom = null
    dropAnsweredTelecom?.let { main.removeCallbacks(it) }
    dropAnsweredTelecom = null
    return telecom
  }

  // ── Inside ───────────────────────────────────────────────────────────────

  private fun start(
    app: Context,
    call: IncomingCall,
    avatar: Bitmap?,
  ) {
    if (isSettled(call.callId) || ring != null) return
    val inApp = listener != null && isInFront(app)
    val timeout = Runnable { finish(app, call.callId, "timeout", null) }
    val telecom = startTelecom(app, call)
    ring = Ring(call, inApp, avatar, telecom, timeout)
    main.postDelayed(timeout, call.ringSeconds.coerceIn(5, 60) * 1000L)
    if (inApp) {
      Ringer.startRing(app)
      listener?.onIncomingCall(call)
    } else {
      IncomingCallNotification.postRinging(app, call, avatar)
    }
  }

  private fun answerOnMain(
    app: Context,
    callId: String,
    fromApp: Boolean,
  ) {
    val current = ring?.takeIf { it.call.callId == callId } ?: return
    ring = null
    markSettled(callId)
    main.removeCallbacks(current.timeout)
    Ringer.stopRing()
    IncomingCallNotification.cancel(app, current.call.channelId)
    screen?.finishRing()
    current.telecom?.let { keepAnsweredTelecom(callId, it) }
    if (!fromApp) {
      answered = current.call
      tellServer(app, callId, "accept", null)
      LockScreenCall.arm(app)
      openApp(app)
      listener?.onIncomingCallAnswered(current.call)
    }
    listener?.onIncomingCallEnded(callId, "answered")
  }

  private fun finish(
    app: Context,
    callId: String,
    reason: String,
    caller: IncomingCall?,
  ) {
    val current = ring?.takeIf { it.call.callId == callId }
    if (current == null) {
      // Never rang here (the push came late or not at all): a missed call
      // still deserves its notification.
      if (isMissed(reason) && caller != null && !isSettled(callId)) {
        IncomingCallNotification.postMissed(app, caller, null)
      }
      markSettled(callId)
      return
    }
    val cause =
      when {
        // core-telecom takes only LOCAL, REMOTE, MISSED and REJECTED.
        reason == "accepted" -> DisconnectCause.REMOTE
        reason == "declined" -> DisconnectCause.REJECTED
        isMissed(reason) -> DisconnectCause.MISSED
        else -> DisconnectCause.REMOTE
      }
    tearDown(app, callId, reason, cause)
    if (isMissed(reason) && !current.inApp) {
      IncomingCallNotification.postMissed(app, current.call, current.avatar)
    }
  }

  /** Stops the ring for `callId` (if it is the one ringing) and says so. */
  private fun tearDown(
    app: Context,
    callId: String,
    reason: String,
    cause: Int,
  ) {
    val current = ring?.takeIf { it.call.callId == callId } ?: return
    ring = null
    markSettled(callId)
    main.removeCallbacks(current.timeout)
    Ringer.stopRing()
    IncomingCallNotification.cancel(app, current.call.channelId)
    screen?.finishRing()
    current.telecom?.stop(cause)
    listener?.onIncomingCallEnded(callId, reason)
  }

  private fun startTelecom(
    app: Context,
    call: IncomingCall,
  ): TelecomCall? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    val events =
      object : TelecomCall.Events {
        override fun onSystemAnswer() = answerOnMain(app, call.callId, fromApp = false)

        override fun onRoutesChanged() = Unit

        override fun onSystemDisconnect(reason: String) {
          // Rejected on a car or watch while ringing.
          if (ring?.call?.callId == call.callId) decline(app, call.callId)
        }

        override fun onSystemMute(muted: Boolean) = Unit

        override fun onFailed(error: Throwable) = Unit
      }
    return try {
      TelecomCall(app, scope, events, incoming = true).also {
        it.start(call.callerName, speakerFirst = false)
      }
    } catch (error: Exception) {
      Log.w(TAG, "Telecom unavailable for the incoming call", error)
      null
    }
  }

  private fun keepAnsweredTelecom(
    callId: String,
    telecom: TelecomCall,
  ) {
    adoptTelecom(null)?.stop()
    telecom.answer()
    answeredTelecom = callId to telecom
    // JS never joined (the call ended first): let Telecom go.
    val drop =
      Runnable {
        adoptTelecom(callId)?.stop()
        if (CallController.info == null) LockScreenCall.disarm()
      }
    dropAnsweredTelecom = drop
    main.postDelayed(drop, ADOPT_WITHIN_MS)
  }

  private fun tellServer(
    app: Context,
    callId: String,
    answer: String,
    then: (() -> Unit)?,
  ) {
    io.execute {
      try {
        val session = Session.load(app) ?: return@execute
        val status = RalphApi.post(session, "/api/calls/${Uri.encode(callId)}/$answer")
        if (status !in 200..299) Log.i(TAG, "$answer answered HTTP $status")
      } finally {
        then?.invoke()
      }
    }
  }

  private fun openApp(app: Context) {
    val intent = app.packageManager.getLaunchIntentForPackage(app.packageName) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    try {
      app.startActivity(intent)
    } catch (error: Exception) {
      // A background start Android refused (a headset answering with the
      // app behind): the app picks the call up when the user opens it.
      Log.w(TAG, "Could not open the app for the answered call", error)
    }
  }

  private fun isInFront(app: Context): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    val visible = info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    val locked = app.getSystemService(KeyguardManager::class.java)?.isKeyguardLocked == true
    return visible && !locked
  }

  private fun isSettled(callId: String): Boolean {
    val now = System.currentTimeMillis()
    settled.entries.removeAll { now - it.value > SETTLED_MEMORY_MS }
    return settled.containsKey(callId)
  }

  private fun markSettled(callId: String) {
    settled[callId] = System.currentTimeMillis()
  }
}
