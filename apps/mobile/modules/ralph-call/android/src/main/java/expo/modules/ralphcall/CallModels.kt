package expo.modules.ralphcall

/** What the notification and Telecom show about the call in progress. */
internal data class CallInfo(
  val channelName: String,
  val serverName: String,
  val muted: Boolean,
  val deafened: Boolean,
  /** Deep link the notification opens, e.g. ralphmeet://call. */
  val openUrl: String?,
  /** Speaker rather than earpiece when no headset is connected. */
  val speakerFirst: Boolean,
  /** The screen is being shared; the notification says so. */
  val sharing: Boolean,
  val startedAt: Long,
)

/** One place call audio can play: speaker, earpiece, a headset. */
internal data class AudioRoute(
  val id: String,
  /** speaker | earpiece | bluetooth | wired | unknown */
  val type: String,
  val name: String,
)

internal data class RouteState(
  val routes: List<AudioRoute>,
  val activeId: String?,
) {
  fun toMaps(): List<Map<String, Any>> =
    routes.map { route ->
      mapOf(
        "id" to route.id,
        "type" to route.type,
        "name" to route.name,
        "active" to (route.id == activeId),
      )
    }

  companion object {
    val EMPTY = RouteState(emptyList(), null)
  }
}

/** Owns call audio (mode, focus, routing) for the length of one call. */
internal interface AudioRouter {
  val state: RouteState

  fun select(id: String): Boolean

  /** Releases audio. Called once, when the call ends for any reason. */
  fun stop()
}
