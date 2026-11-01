package expo.modules.ralphcall

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.util.Log

private const val TAG = "RalphCall"

/** At most this many clips at once; a new one stops the oldest. */
private const val MAX_PLAYERS = 6

/**
 * Short clips during a call: join and leave tones and soundboard sounds. They
 * play as voice communication, so they follow the call's route (speaker,
 * earpiece, a headset) and volume like the people in it. Main thread only.
 */
internal object CallSounds {
  /** A clip finished, was stopped, or failed (with a reason). */
  var onEnded: ((id: String, error: String?) -> Unit)? = null

  private val players = LinkedHashMap<String, MediaPlayer>()

  private val attributes: AudioAttributes =
    AudioAttributes
      .Builder()
      .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

  fun play(
    context: Context,
    id: String,
    uri: String,
    headers: Map<String, String>,
    volume: Float,
  ) {
    // Played again: the new clip takes over the id without an end event.
    players.remove(id)?.release()
    while (players.size >= MAX_PLAYERS) {
      players.keys.firstOrNull()?.let { stop(it) } ?: break
    }
    val player = MediaPlayer()
    players[id] = player
    try {
      player.setAudioAttributes(attributes)
      player.setDataSource(context.applicationContext, Uri.parse(uri), headers)
      val level = volume.coerceIn(0f, 1f)
      player.setVolume(level, level)
      player.setOnPreparedListener { if (players[id] === it) it.start() }
      player.setOnCompletionListener { finish(id, it, null) }
      player.setOnErrorListener { failed, what, extra ->
        finish(id, failed, "MediaPlayer error $what/$extra")
        true
      }
      player.prepareAsync()
    } catch (error: Exception) {
      Log.w(TAG, "Could not play $uri", error)
      finish(id, player, error.message ?: "Could not play")
    }
  }

  fun stop(id: String) {
    val player = players[id] ?: return
    finish(id, player, null)
  }

  fun stopAll() {
    for (id in players.keys.toList()) stop(id)
  }

  private fun finish(
    id: String,
    player: MediaPlayer,
    error: String?,
  ) {
    if (players[id] !== player) {
      player.release()
      return
    }
    players.remove(id)
    player.release()
    onEnded?.invoke(id, error)
  }
}
