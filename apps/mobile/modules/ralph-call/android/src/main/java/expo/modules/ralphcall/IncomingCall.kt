package expo.modules.ralphcall

import android.os.Bundle

/**
 * A DM call ringing this phone: from a `call_ring` push
 * (src/services/call.service.ts) or the gateway's CALL_RING through JS.
 */
internal data class IncomingCall(
  val callId: String,
  val channelId: String,
  val callerId: String,
  val callerName: String,
  /** As stored: may be an API-relative /api/... path. */
  val callerAvatar: String?,
  /** How long it may ring; the server's stop usually comes first. */
  val ringSeconds: Int,
) {
  fun toMap(): Map<String, Any?> =
    mapOf(
      "callId" to callId,
      "channelId" to channelId,
      "callerId" to callerId,
      "callerName" to callerName,
      "callerAvatar" to callerAvatar,
      "ringSeconds" to ringSeconds,
    )

  fun toBundle(): Bundle =
    Bundle().apply {
      putString(KEY_CALL_ID, callId)
      putString(KEY_CHANNEL_ID, channelId)
      putString(KEY_CALLER_ID, callerId)
      putString(KEY_CALLER_NAME, callerName)
      putString(KEY_CALLER_AVATAR, callerAvatar)
      putString(KEY_RING_SECONDS, ringSeconds.toString())
    }

  companion object {
    const val KEY_CALL_ID = "callId"
    const val KEY_CHANNEL_ID = "channelId"
    const val KEY_CALLER_ID = "callerId"
    const val KEY_CALLER_NAME = "callerName"
    const val KEY_CALLER_AVATAR = "callerAvatar"
    const val KEY_RING_SECONDS = "ringSeconds"

    /** The ring when nothing says otherwise: the server's 30 s. */
    const val DEFAULT_RING_SECONDS = 30

    /** From push data or an intent's extras (all string values). */
    fun from(read: (String) -> String?): IncomingCall? {
      val callId = read(KEY_CALL_ID)?.takeIf { it.isNotEmpty() } ?: return null
      return IncomingCall(
        callId = callId,
        channelId = read(KEY_CHANNEL_ID)?.takeIf { it.isNotEmpty() } ?: return null,
        callerId = read(KEY_CALLER_ID) ?: "",
        callerName = read(KEY_CALLER_NAME)?.takeIf { it.isNotBlank() } ?: "Someone",
        callerAvatar = read(KEY_CALLER_AVATAR)?.takeIf { it.isNotEmpty() },
        ringSeconds = read(KEY_RING_SECONDS)?.toIntOrNull() ?: DEFAULT_RING_SECONDS,
      )
    }

    fun from(bundle: Bundle?): IncomingCall? = bundle?.let { b -> from { b.getString(it) } }
  }
}

/** Ring-stop reasons that mean the callee never picked up. */
internal fun isMissed(reason: String): Boolean =
  reason == "timeout" || reason == "cancelled" || reason == "abandoned" || reason == "disconnected"
