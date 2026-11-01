package expo.modules.ralphnotify

import android.content.Intent
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

/**
 * Takes FCM's MESSAGING_EVENT in place of expo-notifications' service (see
 * the manifest). Ralph's data-only pushes are drawn here, natively, so they
 * show with the app killed, without starting JavaScript. Everything else,
 * and token rotation, goes to expo-notifications as before.
 *
 * onMessageReceived runs on a background thread and may block for a few
 * seconds (FCM allows about 20), which covers fetching an avatar.
 */
class RalphMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    if (!RalphPush.isRalph(data)) {
      super.onMessageReceived(remoteMessage)
      return
    }
    if (RalphPush.isCall(data)) {
      forwardCall(data)
      return
    }
    when (val push = RalphPush.parse(data)) {
      is RalphPush.Message -> MessageNotifier.show(applicationContext, push)
      is RalphPush.Read -> MessageNotifier.cancel(applicationContext, push.channelId)
      null -> Unit
    }
  }

  /**
   * A call ring (or its stop) belongs to modules/ralph-call, which owns the
   * ringing screen and Telecom: handed over as a broadcast to this app only
   * (a package-scoped intent reaches a manifest receiver from the
   * background). Needs no JavaScript, so it rings with the app killed.
   */
  private fun forwardCall(data: Map<String, String>) {
    val intent = Intent(RalphPush.ACTION_CALL_PUSH).setPackage(packageName)
    for ((key, value) in data) intent.putExtra(key, value)
    sendBroadcast(intent)
  }
}
