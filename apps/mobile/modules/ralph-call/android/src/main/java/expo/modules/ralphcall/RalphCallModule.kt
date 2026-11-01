package expo.modules.ralphcall

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** Registered by JS with AppRegistry.registerHeadlessTask. */
private const val KEEP_ALIVE_TASK = "RalphCallKeepAlive"

class CallOptions : Record {
  @Field val channelName: String = ""

  @Field val serverName: String = ""

  @Field val muted: Boolean = false

  @Field val deafened: Boolean = false

  @Field val openUrl: String? = null

  @Field val speakerFirst: Boolean = true

  @Field val sharing: Boolean = false

  @Field val answeredCallId: String? = null
}

class IncomingCallRecord : Record {
  @Field val callId: String = ""

  @Field val channelId: String = ""

  @Field val callerId: String = ""

  @Field val callerName: String = ""

  @Field val callerAvatar: String? = null

  @Field val ringSeconds: Int = IncomingCall.DEFAULT_RING_SECONDS
}

class RalphCallModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is gone" }

  private var keepAliveTask: Int? = null

  private val listener =
    object : CallController.Listener {
      override fun onAction(action: String) = sendEvent("onAction", mapOf("action" to action))

      override fun onAudioRoutesChanged(state: RouteState) =
        sendEvent("onAudioRoutesChanged", mapOf("routes" to state.toMaps()))

      override fun onCallEndedBySystem(reason: String) {
        stopKeepAlive()
        sendEvent("onCallEndedBySystem", mapOf("reason" to reason))
      }
    }

  private val incomingListener =
    object : IncomingCalls.Listener {
      override fun onIncomingCall(call: IncomingCall) = sendEvent("onIncomingCall", call.toMap())

      override fun onIncomingCallEnded(
        callId: String,
        reason: String,
      ) = sendEvent("onIncomingCallEnded", mapOf("callId" to callId, "reason" to reason))

      override fun onIncomingCallAnswered(call: IncomingCall) = sendEvent("onIncomingCallAnswered", call.toMap())
    }

  override fun definition() =
    ModuleDefinition {
      Name("RalphCall")

      Events(
        "onAction",
        "onAudioRoutesChanged",
        "onCallEndedBySystem",
        "onIncomingCall",
        "onIncomingCallEnded",
        "onIncomingCallAnswered",
      )

      OnCreate {
        CallController.listener = listener
        IncomingCalls.listener = incomingListener
        appContext.reactContext?.let {
          IncomingCallNotification.ensureChannels(it)
          LockScreenCall.register(it)
        }
        appContext.currentActivity?.let { LockScreenCall.track(it) }
      }

      // The JS that owned the call is gone (reload, teardown): end it.
      OnDestroy {
        if (CallController.listener === listener) CallController.listener = null
        if (IncomingCalls.listener === incomingListener) IncomingCalls.listener = null
        stopKeepAlive()
        appContext.reactContext?.let { CallController.end(it) }
      }

      AsyncFunction("startCall") { options: CallOptions ->
        CallController.listener = listener
        CallController.start(context, options.toInfo())
        startKeepAlive()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("updateCall") { options: CallOptions ->
        CallController.update(context, options.toInfo())
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("endCall") {
        stopKeepAlive()
        CallController.end(context)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("setAudioRoute") { id: String ->
        CallController.selectRoute(id)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("getAudioRoutes") { promise: Promise ->
        promise.resolve(CallController.routes.toMaps())
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("startScreenShare") {
        CallController.startScreenShare()
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("stopScreenShare") {
        CallController.stopScreenShare()
      }.runOnQueue(Queues.MAIN)

      // ── Incoming DM calls ──────────────────────────────────────────

      AsyncFunction("ringIncoming") { call: IncomingCallRecord ->
        IncomingCalls.ring(context, call.toCall())
      }

      AsyncFunction("stopIncoming") { callId: String, reason: String ->
        IncomingCalls.stop(context, callId, reason)
      }

      AsyncFunction("answerIncoming") { callId: String ->
        IncomingCalls.answer(context, callId, fromApp = true)
      }

      AsyncFunction("declineIncoming") { callId: String ->
        IncomingCalls.decline(context, callId)
      }

      AsyncFunction("takeAnsweredCall") { promise: Promise ->
        promise.resolve(IncomingCalls.takeAnswered()?.toMap())
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("setRingback") { on: Boolean ->
        Ringer.setRingback(on)
      }.runOnQueue(Queues.MAIN)

      AsyncFunction("canUseFullScreenIntent") {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          context.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() ?: false
        } else {
          true
        }
      }

      AsyncFunction("openFullScreenIntentSettings") {
        val intent =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}"))
          } else {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
              .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
          }
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }

      // Only acts while startScreenShare() armed it; see onProjectionConsent.
      OnActivityResult { _, payload ->
        CallController.onProjectionConsent(payload.resultCode == Activity.RESULT_OK)
      }
    }

  /**
   * React Native stops JS timers when the activity pauses unless a headless
   * JS task is running (JavaTimerManager), and the sockets' heartbeats are
   * timers: without this the server drops a backgrounded call. The task
   * itself is a promise that never settles; it ends here.
   */
  private fun startKeepAlive() {
    if (keepAliveTask != null) return
    val react = appContext.reactContext as? ReactContext ?: return
    val config = HeadlessJsTaskConfig(KEEP_ALIVE_TASK, Arguments.createMap(), 0, true)
    keepAliveTask = HeadlessJsTaskContext.getInstance(react).startTask(config)
  }

  private fun stopKeepAlive() {
    val task = keepAliveTask ?: return
    keepAliveTask = null
    val react = appContext.reactContext as? ReactContext ?: return
    HeadlessJsTaskContext.getInstance(react).finishTask(task)
  }
}

private fun CallOptions.toInfo() =
  CallInfo(
    channelName = channelName,
    serverName = serverName,
    muted = muted,
    deafened = deafened,
    openUrl = openUrl,
    speakerFirst = speakerFirst,
    sharing = sharing,
    answeredCallId = answeredCallId,
    startedAt = System.currentTimeMillis(),
  )

private fun IncomingCallRecord.toCall() =
  IncomingCall(
    callId = callId,
    channelId = channelId,
    callerId = callerId,
    callerName = callerName.ifBlank { "Someone" },
    callerAvatar = callerAvatar?.takeIf { it.isNotEmpty() },
    ringSeconds = ringSeconds,
  )
