package expo.modules.ralphnotify

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/**
 * Who is signed in, for code that runs with no JavaScript: the FCM service
 * (whose name to show as "You") and the Reply and Mark as read actions
 * (whose token to call the API with). JS mirrors it here on sign-in and
 * clears it on sign-out. The token is sealed with an AES-GCM key that never
 * leaves the Android Keystore, like expo-secure-store's own copy.
 */
data class Session(
  val token: String,
  val apiBaseUrl: String,
  val userId: String,
  val userName: String,
  val userAvatar: String?,
  /** The app's URL scheme, for the links notifications open. */
  val scheme: String,
) {
  /** An API-relative path (avatars) as an absolute URL. */
  fun absolute(url: String): String = if (url.startsWith("/")) apiBaseUrl + url else url

  /** Only the API's own host gets the Bearer token. */
  fun ownsUrl(url: String): Boolean = url.startsWith("$apiBaseUrl/")

  internal fun toJson(): String =
    JSONObject()
      .put("token", token)
      .put("apiBaseUrl", apiBaseUrl)
      .put("userId", userId)
      .put("userName", userName)
      .put("userAvatar", userAvatar ?: JSONObject.NULL)
      .put("scheme", scheme)
      .toString()

  companion object {
    private const val TAG = "RalphNotify"
    private const val PREFS = "ralph_notify"
    private const val KEY_SEALED = "session"
    private const val KEY_ALIAS = "ralph_notify_session"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128

    @Volatile private var cached: Session? = null

    fun save(context: Context, session: Session) {
      val sealed = seal(session.toJson().toByteArray(Charsets.UTF_8))
      prefs(context).edit().putString(KEY_SEALED, sealed).apply()
      cached = session
    }

    fun clear(context: Context) {
      cached = null
      prefs(context).edit().remove(KEY_SEALED).apply()
    }

    fun load(context: Context): Session? {
      cached?.let { return it }
      val sealed = prefs(context).getString(KEY_SEALED, null) ?: return null
      return try {
        val json = JSONObject(String(open(sealed), Charsets.UTF_8))
        Session(
          token = json.getString("token"),
          apiBaseUrl = json.getString("apiBaseUrl"),
          userId = json.getString("userId"),
          userName = json.getString("userName"),
          userAvatar = json.optString("userAvatar").takeUnless { json.isNull("userAvatar") || it.isEmpty() },
          scheme = json.getString("scheme"),
        ).also { cached = it }
      } catch (error: Exception) {
        // A key lost with a restored backup: sign-in writes a fresh copy.
        Log.w(TAG, "session unreadable: ${error.javaClass.simpleName}")
        null
      }
    }

    private fun prefs(context: Context) =
      context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey {
      val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
      val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
      generator.init(
        KeyGenParameterSpec
          .Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          .build(),
      )
      return generator.generateKey()
    }

    private fun seal(plain: ByteArray): String {
      val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
      val iv = cipher.iv
      return Base64.encodeToString(iv + cipher.doFinal(plain), Base64.NO_WRAP)
    }

    private fun open(sealed: String): ByteArray {
      val bytes = Base64.decode(sealed, Base64.NO_WRAP)
      val iv = bytes.copyOfRange(0, IV_BYTES)
      val cipher =
        Cipher.getInstance(TRANSFORMATION).apply {
          init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
        }
      return cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES)
    }
  }
}
