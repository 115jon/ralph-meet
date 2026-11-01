package expo.modules.ralphcall

import android.content.Context
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

  override fun definition() =
    ModuleDefinition {
      Name("RalphCall")

      Events("onAction", "onAudioRoutesChanged", "onCallEndedBySystem")

      OnCreate { CallController.listener = listener }

      // The JS that owned the call is gone (reload, teardown): end it.
      OnDestroy {
        if (CallController.listener === listener) CallController.listener = null
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
    startedAt = System.currentTimeMillis(),
  )
