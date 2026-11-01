package expo.modules.ralphnotify

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import org.json.JSONObject

/**
 * The few API calls notifications make without JavaScript, on the caller's
 * (background) thread. Bearer auth like the app's apiFetch; never logs the
 * token or message text. Public for modules/ralph-call, whose call
 * notifications answer and decline the same way.
 */
object RalphApi {
  private const val TAG = "RalphNotify"
  private const val TIMEOUT_MS = 10_000
  private const val AVATAR_TIMEOUT_MS = 5_000
  private const val AVATAR_PX = 192

  /** POST /api/channels/:id/messages. The HTTP status, or -1 offline. */
  fun postMessage(session: Session, channelId: String, content: String): Int =
    request(
      session,
      "POST",
      "/api/channels/${Uri.encode(channelId)}/messages",
      JSONObject()
        .put("content", content)
        // The echo over the gateway matches the send by nonce, like the app's.
        .put("nonce", UUID.randomUUID().toString())
        .toString(),
    )

  /** PUT /api/channels/:id/read-state. */
  fun markRead(session: Session, channelId: String): Int =
    request(session, "PUT", "/api/channels/${Uri.encode(channelId)}/read-state", "{}")

  /** POST `path` with a JSON `body`. The HTTP status, or -1 offline. */
  fun post(session: Session, path: String, body: String = "{}"): Int = request(session, "POST", path, body)

  private fun request(session: Session, method: String, path: String, body: String): Int {
    val connection = URL(session.apiBaseUrl + path).openConnection() as HttpURLConnection
    return try {
      connection.requestMethod = method
      connection.connectTimeout = TIMEOUT_MS
      connection.readTimeout = TIMEOUT_MS
      connection.doOutput = true
      connection.setRequestProperty("Authorization", "Bearer ${session.token}")
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      connection.responseCode
    } catch (_: Exception) {
      -1
    } finally {
      connection.disconnect()
    }
  }

  /** An avatar, downsampled to about notification size; null on any failure. */
  fun avatar(session: Session?, url: String): Bitmap? {
    val absolute = session?.absolute(url) ?: url
    if (!absolute.startsWith("https://") && !absolute.startsWith("http://")) return null
    val connection = URL(absolute).openConnection() as HttpURLConnection
    return try {
      connection.connectTimeout = AVATAR_TIMEOUT_MS
      connection.readTimeout = AVATAR_TIMEOUT_MS
      if (session != null && session.ownsUrl(absolute)) {
        connection.setRequestProperty("Authorization", "Bearer ${session.token}")
      }
      if (connection.responseCode !in 200..299) {
        Log.w(TAG, "avatar: HTTP ${connection.responseCode}")
        return null
      }
      val bytes = connection.inputStream.use { it.readBytes() }
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      var sample = 1
      while (bounds.outWidth / (sample * 2) >= AVATAR_PX && bounds.outHeight / (sample * 2) >= AVATAR_PX) {
        sample *= 2
      }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
    } catch (error: Exception) {
      Log.w(TAG, "avatar: ${error.javaClass.simpleName}")
      null
    } finally {
      connection.disconnect()
    }
  }
}
