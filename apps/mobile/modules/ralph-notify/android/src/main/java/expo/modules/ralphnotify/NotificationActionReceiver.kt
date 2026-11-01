package expo.modules.ralphnotify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import androidx.core.os.BundleCompat
import java.util.concurrent.Executors

/**
 * Reply and Mark as read from a message notification. Both call the API
 * natively with the mirrored session, so they work with the app killed;
 * goAsync keeps the receiver alive for the request (well under its ~10 s).
 */
class NotificationActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val conversation =
      Conversation.from(
        intent.extras?.let { BundleCompat.getParcelable(it, EXTRA_CONVERSATION, android.os.Bundle::class.java) },
      ) ?: return
    val app = context.applicationContext
    val action = intent.action?.substringAfterLast('.') ?: return
    val reply =
      if (action == ACTION_REPLY) {
        RemoteInput
          .getResultsFromIntent(intent)
          ?.getCharSequence(MessageNotifier.REMOTE_INPUT_KEY)
          ?.toString()
          ?.trim()
          ?.takeIf { it.isNotEmpty() } ?: return
      } else {
        null
      }
    val pending = goAsync()
    worker.execute {
      try {
        val session = Session.load(app)
        when {
          session == null -> MessageNotifier.cancel(app, conversation.channelId)
          reply != null -> {
            val status = RalphApi.postMessage(session, conversation.channelId, reply)
            MessageNotifier.showReply(app, conversation, reply, sent = status in 200..299)
          }
          action == ACTION_MARK_READ -> {
            // Down at once; the read push from the server clears other devices.
            MessageNotifier.cancel(app, conversation.channelId)
            RalphApi.markRead(session, conversation.channelId)
          }
        }
      } finally {
        pending.finish()
      }
    }
  }

  companion object {
    const val ACTION_REPLY = "reply"
    const val ACTION_MARK_READ = "read"
    const val EXTRA_CONVERSATION = "conversation"

    private val worker = Executors.newSingleThreadExecutor()
  }
}
