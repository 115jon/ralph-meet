package expo.modules.ralphcall

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Decline on the incoming call notification. Works with the app killed: the
 * ring stops here and the server is told natively; goAsync keeps the
 * receiver alive for the request (well under its ~10 s).
 */
class IncomingCallActionReceiver : BroadcastReceiver() {
  override fun onReceive(
    context: Context,
    intent: Intent,
  ) {
    val call = IncomingCall.from(intent.extras) ?: return
    val pending = goAsync()
    IncomingCalls.decline(context, call.callId) { pending.finish() }
  }

  internal companion object {
    fun declineIntent(
      context: Context,
      call: IncomingCall,
    ): PendingIntent {
      val intent =
        Intent(context, IncomingCallActionReceiver::class.java)
          .setAction("${context.packageName}.call.decline")
          .putExtras(call.toBundle())
      return PendingIntent.getBroadcast(
        context,
        call.callId.hashCode(),
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }
  }
}
