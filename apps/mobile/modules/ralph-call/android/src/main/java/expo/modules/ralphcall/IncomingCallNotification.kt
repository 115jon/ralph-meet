package expo.modules.ralphcall

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import expo.modules.ralphnotify.Session

/**
 * The incoming call's notifications. Ringing: CallStyle.forIncomingCall with
 * Decline and Answer, a full-screen intent to [IncomingCallActivity] (the
 * lock screen; Android shows a heads-up instead while the phone is in use
 * or the user has not allowed full-screen notifications), and the ringtone
 * looping from the channel, so silent mode and Do Not Disturb apply. Missed:
 * the same tag and id, so it replaces the ring, with Call back and Message.
 */
internal object IncomingCallNotification {
  private const val TAG = "RalphCall"

  // Channel ids are stable API: renaming one orphans what the user set on it.
  const val CHANNEL_RINGING = "incoming_calls"
  const val CHANNEL_MISSED = "missed_calls"
  /** ralph-notify's unused "Calls" channel from before calls rang. */
  private const val LEGACY_CHANNEL = "calls"

  /** One notification per DM, told apart by tag: the ring, then the missed call. */
  private const val ID = 0x52_43_4C

  fun ensureChannels(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    val ringtone =
      RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_RINGTONE)
        ?: android.provider.Settings.System.DEFAULT_RINGTONE_URI
    manager.createNotificationChannelsCompat(
      listOf(
        NotificationChannelCompat
          .Builder(CHANNEL_RINGING, NotificationManagerCompat.IMPORTANCE_HIGH)
          .setName("Incoming calls")
          .setDescription("Rings when someone calls you")
          .setSound(
            ringtone,
            AudioAttributes
              .Builder()
              .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
              .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
              .build(),
          ).setVibrationEnabled(true)
          .setVibrationPattern(longArrayOf(0, 800, 800, 800, 800))
          .build(),
        NotificationChannelCompat
          .Builder(CHANNEL_MISSED, NotificationManagerCompat.IMPORTANCE_DEFAULT)
          .setName("Missed calls")
          .setDescription("Calls you didn't answer")
          .build(),
      ),
    )
    manager.deleteNotificationChannel(LEGACY_CHANNEL)
  }

  @SuppressLint("MissingPermission")
  fun postRinging(
    context: Context,
    call: IncomingCall,
    avatar: Bitmap?,
  ) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    ensureChannels(context)
    val caller =
      Person
        .Builder()
        .setKey(call.callerId)
        .setName(call.callerName)
        .setIcon(avatar?.let { IconCompat.createWithBitmap(it) })
        .setImportant(true)
        .build()
    val screen = activityIntent(context, call, IncomingCallActivity.ACTION_SHOW)
    val style =
      NotificationCompat.CallStyle.forIncomingCall(
        caller,
        IncomingCallActionReceiver.declineIntent(context, call),
        // An activity, not a receiver: Android 12+ refuses activity starts
        // from a notification's broadcast (trampolines), and Answer opens
        // the app.
        activityIntent(context, call, IncomingCallActivity.ACTION_ANSWER),
      )
    val notification =
      NotificationCompat
        .Builder(context, CHANNEL_RINGING)
        .setSmallIcon(R.drawable.ralph_call_phone)
        .setContentTitle(call.callerName)
        .setContentText("Incoming voice call")
        .setStyle(style)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setFullScreenIntent(screen, true)
        .setContentIntent(screen)
        .setOngoing(true)
        .setAutoCancel(false)
        .setShowWhen(false)
        .setTimeoutAfter(call.ringSeconds * 1000L + 5_000L)
        .build()
    // The ringtone repeats until the ring is answered or taken down.
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    try {
      manager.notify(call.channelId, ID, notification)
    } catch (error: Exception) {
      Log.w(TAG, "Could not post the incoming call", error)
    }
  }

  fun cancel(
    context: Context,
    channelId: String,
  ) {
    NotificationManagerCompat.from(context).cancel(channelId, ID)
  }

  @SuppressLint("MissingPermission")
  fun postMissed(
    context: Context,
    call: IncomingCall,
    avatar: Bitmap?,
  ) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    val session = Session.load(context) ?: return
    ensureChannels(context)
    val open = dmIntent(context, session, call, callBack = false, slot = 0)
    val notification =
      NotificationCompat
        .Builder(context, CHANNEL_MISSED)
        .setSmallIcon(R.drawable.ralph_call_phone_slash)
        .setContentTitle("Missed call")
        .setContentText(call.callerName)
        .setLargeIcon(avatar)
        .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setAutoCancel(true)
        .setShowWhen(true)
        .setWhen(System.currentTimeMillis())
        .setContentIntent(open)
        .addAction(
          R.drawable.ralph_call_phone,
          "Call back",
          dmIntent(context, session, call, callBack = true, slot = 1),
        ).addAction(R.drawable.ralph_call_message, "Message", open)
        .build()
    try {
      manager.notify(call.channelId, ID, notification)
    } catch (error: Exception) {
      Log.w(TAG, "Could not post the missed call", error)
    }
  }

  fun activityIntent(
    context: Context,
    call: IncomingCall,
    action: String,
  ): PendingIntent {
    val intent =
      Intent(context, IncomingCallActivity::class.java)
        .setAction("${context.packageName}.call.$action")
        .putExtras(call.toBundle())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
    return PendingIntent.getActivity(
      context,
      call.callId.hashCode() * 4 + if (action == IncomingCallActivity.ACTION_ANSWER) 1 else 0,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  /** The DM in the app; `callBack` asks it to ring them (dm/[id]?call=1). */
  private fun dmIntent(
    context: Context,
    session: Session,
    call: IncomingCall,
    callBack: Boolean,
    slot: Int,
  ): PendingIntent {
    val uri =
      Uri
        .Builder()
        .scheme(session.scheme)
        .authority("dm")
        .appendPath(call.channelId)
        .apply { if (callBack) appendQueryParameter("call", "1") }
        .build()
    val intent =
      Intent(Intent.ACTION_VIEW, uri)
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      call.channelId.hashCode() * 4 + slot,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}
