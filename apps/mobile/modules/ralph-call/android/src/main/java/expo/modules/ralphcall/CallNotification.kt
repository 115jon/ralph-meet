package expo.modules.ralphcall

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat

/** The ongoing-call notification: channel, server, Mute and Hang up. */
internal object CallNotification {
  const val ID = 0x52_41_4C
  const val ACTION_MUTE = "mute"
  const val ACTION_UNMUTE = "unmute"
  const val ACTION_HANGUP = "hangup"

  private const val CHANNEL_ID = "ralph_call"
  private const val EXTRA_ACTION = "action"

  /** Idempotent; low importance so it never rings or buzzes. */
  fun ensureChannel(context: Context) {
    val channel =
      NotificationChannelCompat
        .Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_LOW)
        .setName("Voice calls")
        .setDescription("Shows the voice channel you are in")
        .setShowBadge(false)
        .setVibrationEnabled(false)
        .setSound(null, null)
        .build()
    NotificationManagerCompat.from(context).createNotificationChannel(channel)
  }

  fun build(context: Context, call: CallInfo): Notification {
    val person = Person.Builder().setName(call.channelName).setImportant(true).build()
    // CallStyle (Android 12+) needs the notification to belong to a
    // foreground service or carry a full-screen intent; it is always posted
    // as RalphCallService's notification.
    val style = NotificationCompat.CallStyle.forOngoingCall(person, actionIntent(context, ACTION_HANGUP))
    val mute =
      NotificationCompat.Action
        .Builder(
          IconCompat.createWithResource(context, if (call.muted) R.drawable.ralph_call_mic_slash else R.drawable.ralph_call_mic),
          if (call.muted) "Unmute" else "Mute",
          actionIntent(context, if (call.muted) ACTION_UNMUTE else ACTION_MUTE),
        ).build()
    val status =
      when {
        call.deafened -> "Deafened"
        call.muted -> "Muted"
        else -> null
      }
    val sharing = if (call.sharing) "Sharing your screen" else null
    return NotificationCompat
      .Builder(context, CHANNEL_ID)
      .setSmallIcon(if (call.muted) R.drawable.ralph_call_mic_slash else R.drawable.ralph_call_mic)
      .setContentTitle(call.channelName)
      .setContentText(listOfNotNull(sharing, call.serverName.ifBlank { null }, status).joinToString(" · "))
      .setStyle(style)
      .addAction(mute)
      .setContentIntent(openIntent(context, call.openUrl))
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setOngoing(true)
      .setSilent(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(true)
      .setWhen(call.startedAt)
      .setUsesChronometer(true)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      // Show at once rather than after Android 12's 10 s grace period.
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  /**
   * Re-posts under the service's id; Android keeps it attached to the
   * running foreground service, so CallStyle stays allowed.
   */
  @SuppressLint("MissingPermission")
  fun post(context: Context, call: CallInfo) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    try {
      manager.notify(ID, build(context, call))
    } catch (error: Exception) {
      Log.w("RalphCall", "Could not update the call notification", error)
    }
  }

  fun cancel(context: Context) {
    NotificationManagerCompat.from(context).cancel(ID)
  }

  fun actionOf(intent: Intent?): String? = intent?.getStringExtra(EXTRA_ACTION)

  private fun actionIntent(context: Context, action: String): PendingIntent {
    val intent =
      Intent(context, CallActionReceiver::class.java)
        .setAction("${context.packageName}.call.$action")
        .putExtra(EXTRA_ACTION, action)
    return PendingIntent.getBroadcast(
      context,
      action.hashCode(),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  /** Opens the app on the call screen (or just the app with no link). */
  private fun openIntent(context: Context, url: String?): PendingIntent? {
    val intent =
      if (url != null) {
        Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(context.packageName)
      } else {
        context.packageManager.getLaunchIntentForPackage(context.packageName)
      } ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}
