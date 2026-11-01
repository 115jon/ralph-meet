package expo.modules.ralphnotify

import android.os.Build
import java.time.Instant

/**
 * A Ralph data-only push (src/services/push.service.ts on the server), from
 * the FCM data map. `ralph` = "2" marks the format; anything else is not
 * ours and goes to expo-notifications.
 */
sealed interface RalphPush {
  /** A mention, reply or DM to draw as a conversation message. */
  data class Message(
    val type: String,
    val channelId: String,
    val serverId: String?,
    val messageId: String,
    val senderId: String,
    val senderName: String,
    val senderAvatar: String?,
    /** "#general" for a server channel; null for a DM. */
    val conversation: String?,
    val serverName: String?,
    val preview: String,
    val sentAt: Long,
  ) : RalphPush {
    val isDm: Boolean get() = serverId == null
  }

  /** The conversation was read somewhere: take its notification down. */
  data class Read(val channelId: String) : RalphPush

  companion object {
    const val FORMAT = "2"

    /** The broadcast modules/ralph-call receives call pushes on. */
    const val ACTION_CALL_PUSH = "dev.jontitor.ralph.CALL_PUSH"

    fun isRalph(data: Map<String, String>): Boolean = data["ralph"] == FORMAT

    /** call_ring and call_ring_stop: not drawn here (see forwardCall). */
    fun isCall(data: Map<String, String>): Boolean = data["kind"]?.startsWith("call_") == true

    fun parse(data: Map<String, String>): RalphPush? {
      if (!isRalph(data)) return null
      val channelId = data["channelId"]?.takeIf { it.isNotEmpty() } ?: return null
      return when (data["kind"]) {
        "read" -> Read(channelId)
        "message" ->
          Message(
            type = data["type"] ?: "mention",
            channelId = channelId,
            serverId = data["serverId"]?.takeIf { it.isNotEmpty() },
            messageId = data["messageId"] ?: return null,
            senderId = data["senderId"] ?: return null,
            senderName = data["senderName"] ?: "Someone",
            senderAvatar = data["senderAvatar"]?.takeIf { it.isNotEmpty() },
            conversation = data["conversation"]?.takeIf { it.isNotEmpty() },
            serverName = data["serverName"]?.takeIf { it.isNotEmpty() },
            preview = data["preview"] ?: "",
            sentAt = data["sentAt"]?.let(::epochMillis) ?: System.currentTimeMillis(),
          )
        else -> null
      }
    }

    /** An ISO instant; null where java.time is missing (API 24-25) or it is malformed. */
    private fun epochMillis(iso: String): Long? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()
      } else {
        null
      }
  }
}
