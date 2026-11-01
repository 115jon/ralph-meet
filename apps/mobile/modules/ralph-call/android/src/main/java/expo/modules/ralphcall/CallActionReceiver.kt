package expo.modules.ralphcall

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** The notification's Mute, Unmute and Hang up buttons. */
class CallActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = CallNotification.actionOf(intent) ?: return
    CallController.onNotificationAction(context, action)
  }
}
