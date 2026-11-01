package expo.modules.ralphcall

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * `call_ring` and `call_ring_stop` pushes (src/services/call.service.ts),
 * handed over by ralph-notify's FCM service. The data keys are the push's
 * own (callId, channelId, callerId, callerName, callerAvatar, ringSeconds,
 * reason). The ring itself fetches the avatar on its own thread.
 */
class CallPushReceiver : BroadcastReceiver() {
  override fun onReceive(
    context: Context,
    intent: Intent,
  ) {
    val call = IncomingCall.from { intent.getStringExtra(it) } ?: return
    when (intent.getStringExtra("kind")) {
      "call_ring" -> {
        // Alive until the ring is up: the avatar fetch runs off this thread.
        val pending = goAsync()
        IncomingCalls.ring(context, call) { pending.finish() }
      }
      "call_ring_stop" ->
        IncomingCalls.stop(context, call.callId, intent.getStringExtra("reason") ?: "ended", call)
    }
  }
}
