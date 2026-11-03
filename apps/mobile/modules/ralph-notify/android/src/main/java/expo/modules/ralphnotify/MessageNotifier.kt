package expo.modules.ralphnotify

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Shader
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.core.content.LocusIdCompat
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Message notifications drawn on the device: one MessagingStyle notification
 * per conversation (sender avatars, the conversation's title, the last few
 * messages), grouped under a summary, with Reply and Mark as read. Each
 * conversation also gets a long-lived sharing shortcut, which is what puts it
 * in Android 11+'s Conversations section (priority, bubbles, per-chat sound).
 */
internal object MessageNotifier {
  private const val TAG = "RalphNotify"

  // Channels users tune in system settings. Ids are stable API: renaming one
  // orphans what the user set on it.
  const val CHANNEL_DMS = "dms"
  const val CHANNEL_MENTIONS = "mentions"
  // Calls ring on modules/ralph-call's own channels (incoming_calls rings
  // with the ringtone, which a channel cannot change once created).
  const val CHANNEL_OTHER = "other"
  /** Versions before 0.3 posted every push on one channel. */
  private const val LEGACY_CHANNEL = "messages"

  private const val GROUP = "ralph.messages"
  /** Conversations are told apart by tag (the channel id); the id is shared. */
  private const val CONVERSATION_ID = 1
  private const val SUMMARY_ID = 0x52A1
  private const val SUMMARY_TAG = "ralph.summary"
  private const val MAX_MESSAGES = 8
  private const val EXTRA_MESSAGE_ID = "ralph.messageId"
  private const val EXTRA_CONVERSATION = "ralph.conversation"

  const val REMOTE_INPUT_KEY = "ralph.reply"

  /** The conversation on screen in the app (set from JS); its pushes stay quiet. */
  @Volatile var activeConversation: String? = null

  fun ensureChannels(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    manager.createNotificationChannelsCompat(
      listOf(
        NotificationChannelCompat
          .Builder(CHANNEL_DMS, NotificationManagerCompat.IMPORTANCE_HIGH)
          .setName("Direct messages")
          .setDescription("Messages sent to you directly")
          .build(),
        NotificationChannelCompat
          .Builder(CHANNEL_MENTIONS, NotificationManagerCompat.IMPORTANCE_HIGH)
          .setName("Mentions and replies")
          .setDescription("When someone mentions you or replies to you in a server")
          .build(),
        NotificationChannelCompat
          .Builder(CHANNEL_OTHER, NotificationManagerCompat.IMPORTANCE_DEFAULT)
          .setName("Other")
          .setDescription("Everything else Yap tells you")
          .build(),
      ),
    )
    manager.deleteNotificationChannel(LEGACY_CHANNEL)
  }

  /** Adds `push` to its conversation's notification, or starts one. */
  @SuppressLint("MissingPermission")
  fun show(context: Context, push: RalphPush.Message) {
    val manager = NotificationManagerCompat.from(context)
    if (!manager.areNotificationsEnabled()) return
    if (push.channelId == activeConversation && isAppInForeground(context)) return
    val session = Session.load(context) ?: return
    ensureChannels(context)

    val sender =
      Person
        .Builder()
        .setKey(push.senderId)
        .setName(push.senderName)
        .setIcon(push.senderAvatar?.let { RalphApi.avatar(session, it) }?.let { IconCompat.createWithBitmap(circle(it)) })
        .build()
    val previous = activeStyle(context, push.channelId)
    if (previous?.messages?.any { it.extras.getString(EXTRA_MESSAGE_ID) == push.messageId } == true) return

    val conversation = Conversation.of(push)
    val style = previous ?: newStyle(session, conversation)
    style.addMessage(
      NotificationCompat.MessagingStyle
        .Message(push.preview, push.sentAt, sender)
        .also { it.extras.putString(EXTRA_MESSAGE_ID, push.messageId) },
    )
    trim(style)

    val shortcutId = publishShortcut(context, session, conversation, sender)
    val notification =
      builder(context, session, conversation, style)
        .setShortcutId(shortcutId)
        .setLocusId(LocusIdCompat(shortcutId))
        .setWhen(push.sentAt)
        .build()
    post(context, conversation.channelId, notification)
    postSummary(context)
  }

  /**
   * After an inline reply: the reply joins the conversation (or a line says
   * it failed), quietly, which also stops the action's spinner.
   */
  @SuppressLint("MissingPermission")
  fun showReply(context: Context, conversation: Conversation, text: String, sent: Boolean) {
    val session = Session.load(context) ?: return
    val style = activeStyle(context, conversation.channelId) ?: newStyle(session, conversation)
    style.addMessage(
      if (sent) {
        NotificationCompat.MessagingStyle.Message(text, System.currentTimeMillis(), self(session))
      } else {
        // A message with no person reads as a line from the app itself.
        NotificationCompat.MessagingStyle.Message("Not sent: $text", System.currentTimeMillis(), null as Person?)
      },
    )
    trim(style)
    val notification =
      builder(context, session, conversation, style)
        .setShortcutId(conversation.shortcutId)
        .setLocusId(LocusIdCompat(conversation.shortcutId))
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .build()
    post(context, conversation.channelId, notification)
  }

  fun cancel(context: Context, channelId: String) {
    NotificationManagerCompat.from(context).cancel(channelId, CONVERSATION_ID)
    postSummary(context)
  }

  fun cancelAll(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    for (active in manager.activeNotifications) {
      if (active.notification.group == GROUP) manager.cancel(active.tag, active.id)
    }
  }

  /** Sign-out: no notification or shortcut may outlive the account. */
  fun forgetAll(context: Context) {
    cancelAll(context)
    ShortcutManagerCompat.removeAllDynamicShortcuts(context)
  }

  // ── Building ─────────────────────────────────────────────────────────────

  private fun self(session: Session): Person =
    Person.Builder().setKey(session.userId).setName("You").build()

  // MessagingStyle has its own apply(builder), which shadows Kotlin's: set
  // it up with plain calls.
  private fun newStyle(session: Session, conversation: Conversation): NotificationCompat.MessagingStyle {
    val style = NotificationCompat.MessagingStyle(self(session))
    // A DM is titled by the person on its messages; a channel by its name.
    if (!conversation.isDm) {
      style.setConversationTitle(conversation.title)
      style.setGroupConversation(true)
    }
    return style
  }

  private fun builder(
    context: Context,
    session: Session,
    conversation: Conversation,
    style: NotificationCompat.MessagingStyle,
  ): NotificationCompat.Builder {
    val last = style.messages.lastOrNull()
    return NotificationCompat
      .Builder(context, conversation.channel)
      .setSmallIcon(R.drawable.ralph_notify_small)
      .setStyle(style)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setGroup(GROUP)
      // The summary stays silent; each conversation alerts on its own.
      .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion(context, conversation))
      .setContentTitle(conversation.title)
      .setContentText(last?.text)
      .setContentIntent(openIntent(context, session, conversation, lastMessageId(style)))
      .addAction(replyAction(context, conversation))
      .addAction(markReadAction(context, conversation))
      .addExtras(Bundle().apply { putBundle(EXTRA_CONVERSATION, conversation.toBundle()) })
  }

  /** What the lock screen shows when contents are hidden. */
  private fun publicVersion(context: Context, conversation: Conversation) =
    NotificationCompat
      .Builder(context, conversation.channel)
      .setSmallIcon(R.drawable.ralph_notify_small)
      .setContentTitle(if (conversation.isDm) "New direct message" else "New message")
      .build()

  /** Keeps the last few messages, like the system's own messaging apps. */
  private fun trim(style: NotificationCompat.MessagingStyle) {
    val messages = style.messages
    while (messages.size > MAX_MESSAGES) messages.removeAt(0)
  }

  private fun lastMessageId(style: NotificationCompat.MessagingStyle): String? =
    style.messages.lastOrNull { it.extras.getString(EXTRA_MESSAGE_ID) != null }?.extras?.getString(EXTRA_MESSAGE_ID)

  /** The conversation's notification still in the tray, as a style to add to. */
  private fun activeStyle(context: Context, channelId: String): NotificationCompat.MessagingStyle? {
    val active =
      NotificationManagerCompat.from(context).activeNotifications.firstOrNull {
        it.tag == channelId && it.id == CONVERSATION_ID
      } ?: return null
    return NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(active.notification)
  }

  @SuppressLint("MissingPermission")
  private fun post(context: Context, channelId: String, notification: android.app.Notification) {
    try {
      NotificationManagerCompat.from(context).notify(channelId, CONVERSATION_ID, notification)
    } catch (error: Exception) {
      Log.w(TAG, "could not post a message notification", error)
    }
  }

  /** The group's summary while two or more conversations are up; gone with the last. */
  @SuppressLint("MissingPermission")
  private fun postSummary(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    val conversations =
      manager.activeNotifications.filter { it.notification.group == GROUP && it.id == CONVERSATION_ID }
    if (conversations.isEmpty()) {
      manager.cancel(SUMMARY_TAG, SUMMARY_ID)
      return
    }
    val lines = NotificationCompat.InboxStyle()
    for (active in conversations.take(5)) {
      val extras = active.notification.extras
      val title = extras.getCharSequence(NotificationCompat.EXTRA_TITLE) ?: continue
      lines.addLine("$title  ${extras.getCharSequence(NotificationCompat.EXTRA_TEXT) ?: ""}")
    }
    val count = conversations.size
    val summary =
      NotificationCompat
        .Builder(context, CHANNEL_OTHER)
        .setSmallIcon(R.drawable.ralph_notify_small)
        .setStyle(lines.setSummaryText(if (count == 1) "1 conversation" else "$count conversations"))
        .setContentTitle("Yap")
        .setContentText(if (count == 1) "1 conversation" else "$count conversations")
        .setGroup(GROUP)
        .setGroupSummary(true)
        .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        .setSilent(true)
        .setAutoCancel(true)
        .setContentIntent(launchIntent(context))
        .build()
    try {
      manager.notify(SUMMARY_TAG, SUMMARY_ID, summary)
    } catch (error: Exception) {
      Log.w(TAG, "could not post the summary", error)
    }
  }

  // ── Intents ──────────────────────────────────────────────────────────────

  /** The link the app routes: the conversation, scrolled to the message. */
  fun conversationUri(session: Session, conversation: Conversation, messageId: String?): Uri {
    val path = if (conversation.isDm) "dm" else "channel"
    return Uri
      .Builder()
      .scheme(session.scheme)
      .authority(path)
      .appendPath(conversation.channelId)
      .apply { if (messageId != null) appendQueryParameter("message", messageId) }
      .build()
  }

  private fun openIntent(
    context: Context,
    session: Session,
    conversation: Conversation,
    messageId: String?,
  ): PendingIntent {
    val intent =
      Intent(Intent.ACTION_VIEW, conversationUri(session, conversation, messageId))
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      conversation.requestCode(0),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun launchIntent(context: Context): PendingIntent? {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    return PendingIntent.getActivity(context, SUMMARY_ID, intent, PendingIntent.FLAG_IMMUTABLE)
  }

  private fun actionIntent(context: Context, action: String, conversation: Conversation, mutable: Boolean): PendingIntent {
    val intent =
      Intent(context, NotificationActionReceiver::class.java)
        .setAction("${context.packageName}.notify.$action")
        .putExtra(NotificationActionReceiver.EXTRA_CONVERSATION, conversation.toBundle())
    // RemoteInput fills the intent in, so Reply's must be mutable (an
    // explicit intent to our own receiver, which Android 12+ allows).
    val mutability =
      when {
        !mutable -> PendingIntent.FLAG_IMMUTABLE
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> PendingIntent.FLAG_MUTABLE
        else -> 0
      }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or mutability
    val request = conversation.requestCode(if (action == NotificationActionReceiver.ACTION_REPLY) 1 else 2)
    return PendingIntent.getBroadcast(context, request, intent, flags)
  }

  private fun replyAction(context: Context, conversation: Conversation): NotificationCompat.Action {
    val input = RemoteInput.Builder(REMOTE_INPUT_KEY).setLabel("Message ${conversation.replyLabel}").build()
    return NotificationCompat.Action
      .Builder(
        IconCompat.createWithResource(context, R.drawable.ralph_notify_reply),
        "Reply",
        actionIntent(context, NotificationActionReceiver.ACTION_REPLY, conversation, mutable = true),
      ).addRemoteInput(input)
      .setAllowGeneratedReplies(true)
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
      .setShowsUserInterface(false)
      .build()
  }

  private fun markReadAction(context: Context, conversation: Conversation): NotificationCompat.Action =
    NotificationCompat.Action
      .Builder(
        IconCompat.createWithResource(context, R.drawable.ralph_notify_read),
        "Mark as read",
        actionIntent(context, NotificationActionReceiver.ACTION_MARK_READ, conversation, mutable = false),
      ).setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
      .setShowsUserInterface(false)
      .build()

  // ── Shortcuts ────────────────────────────────────────────────────────────

  /** The conversation's long-lived shortcut, pushed (rate-limit safe) to the front. */
  private fun publishShortcut(context: Context, session: Session, conversation: Conversation, sender: Person): String {
    val icon =
      if (conversation.isDm) {
        sender.icon
      } else {
        null
      } ?: IconCompat.createWithResource(context, context.applicationInfo.icon)
    val shortcut =
      ShortcutInfoCompat
        .Builder(context, conversation.shortcutId)
        .setShortLabel(if (conversation.isDm) sender.name ?: conversation.title else conversation.title)
        .setLongLived(true)
        .setLocusId(LocusIdCompat(conversation.shortcutId))
        .setIcon(icon)
        .setIntent(
          Intent(Intent.ACTION_VIEW, conversationUri(session, conversation, null)).setPackage(context.packageName),
        ).apply { if (conversation.isDm) setPerson(sender) }
        .build()
    try {
      ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
    } catch (error: Exception) {
      Log.w(TAG, "could not publish a conversation shortcut", error)
    }
    return conversation.shortcutId
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private fun isAppInForeground(context: Context): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  private fun circle(source: Bitmap): Bitmap {
    val size = minOf(source.width, source.height)
    val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val paint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        shader =
          BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply {
            setLocalMatrix(
              android.graphics.Matrix().apply {
                setTranslate(-(source.width - size) / 2f, -(source.height - size) / 2f)
              },
            )
          }
      }
    Canvas(output).drawCircle(size / 2f, size / 2f, size / 2f, paint)
    return output
  }
}

/** What a notification and its actions need to know about the conversation. */
internal data class Conversation(
  val channelId: String,
  val isDm: Boolean,
  /** "#general · Ralph" for a channel; the person's name for a DM. */
  val title: String,
  /** The Android channel it posts on. */
  val channel: String,
) {
  val shortcutId: String get() = "conversation:$channelId"

  /** The reply field's hint: "Message #general" or "Message Ada". */
  val replyLabel: String get() = title.substringBefore(" · ")

  fun requestCode(slot: Int): Int = channelId.hashCode() * 4 + slot

  fun toBundle(): Bundle =
    Bundle().apply {
      putString("channelId", channelId)
      putBoolean("isDm", isDm)
      putString("title", title)
      putString("channel", channel)
    }

  companion object {
    fun of(push: RalphPush.Message) =
      Conversation(
        channelId = push.channelId,
        isDm = push.isDm,
        title =
          if (push.isDm) {
            push.senderName
          } else {
            listOfNotNull(push.conversation, push.serverName).joinToString(" · ").ifEmpty { "Yap" }
          },
        channel =
          when {
            push.isDm -> MessageNotifier.CHANNEL_DMS
            else -> MessageNotifier.CHANNEL_MENTIONS
          },
      )

    fun from(bundle: Bundle?): Conversation? {
      val channelId = bundle?.getString("channelId") ?: return null
      return Conversation(
        channelId = channelId,
        isDm = bundle.getBoolean("isDm"),
        title = bundle.getString("title") ?: "Yap",
        channel = bundle.getString("channel") ?: MessageNotifier.CHANNEL_OTHER,
      )
    }
  }
}
