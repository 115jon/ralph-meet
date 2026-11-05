package expo.modules.ralphnetwork

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import com.facebook.react.modules.network.OkHttpClientProvider
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient

/**
 * The HTTP client under React Native's fetch, made to survive a dead network.
 *
 * React Native's OkHttp client has no timeouts, and after the network drops
 * its pooled connections stay in the pool. Cloudflare speaks HTTP/2, so every
 * request to the API is multiplexed onto one pooled connection: once that
 * connection is dead, every request (and every retry, even after an abort
 * cancels the last one) is sent down it and never answered.
 *
 * Two fixes, both through public OkHttp and React Native API:
 *
 * - The client comes from [OkHttpClientProvider.setOkHttpClientFactory], with
 *   connect, read and write timeouts. A read timeout on an HTTP/2 stream also
 *   makes OkHttp ping the connection and stop reusing it if no pong comes.
 * - When the default network changes or is lost, or JS calls [reset], every
 *   HTTP call in flight is cancelled and the pool is emptied, so the next
 *   request opens a fresh connection on the network that works. A browser
 *   does the same (ERR_NETWORK_CHANGED). WebSockets are left alone: their
 *   owners probe them and decide.
 *
 * Network callbacks, resets and listeners all run on one background thread:
 * closing a pooled TLS connection writes to its socket, which the main
 * thread may not do.
 */
object RalphNetwork {
  private const val TAG = "RalphNetwork"
  private const val CONNECT_TIMEOUT_S = 10L
  private const val READ_TIMEOUT_S = 30L
  private const val WRITE_TIMEOUT_S = 30L

  /**
   * A cancelled HTTP/2 stream releases its connection a moment later, and
   * evictAll() skips a connection still in use: evict again, covering a call
   * socket's first retry (250–500 ms after a reset).
   */
  private val LATER_EVICTS_MS = longArrayOf(100L, 300L, 1000L)

  /**
   * Every client the factory built: fetch's, the WebSocket module's base and
   * expo-image's. Each keeps its own dispatcher and pool, as before, so image
   * loads never queue an API request behind them (5 calls per host).
   */
  private val clients = CopyOnWriteArrayList<OkHttpClient>()
  private val worker: Handler by lazy {
    Handler(HandlerThread(TAG).apply { start() }.looper)
  }

  /** Called on the worker thread with `connected` after each change. */
  val listeners = CopyOnWriteArraySet<(Boolean) -> Unit>()

  @Volatile private var installed = false

  /** Only touched on the worker thread. */
  private var current: Network? = null

  @Volatile var connected: Boolean = true
    private set

  fun install(context: Context) {
    if (installed) return
    installed = true
    val app = context.applicationContext
    OkHttpClientProvider.setOkHttpClientFactory {
      OkHttpClientProvider
        .createClientBuilder(app)
        .connectTimeout(CONNECT_TIMEOUT_S, TimeUnit.SECONDS)
        .readTimeout(READ_TIMEOUT_S, TimeUnit.SECONDS)
        .writeTimeout(WRITE_TIMEOUT_S, TimeUnit.SECONDS)
        .build()
        .also { clients.add(it) }
    }
    watchDefaultNetwork(app)
  }

  /** Cancels HTTP calls in flight (not WebSockets) and empties the pool. Any thread. */
  fun reset(reason: String) {
    worker.post { resetNow(reason) }
  }

  /**
   * The calls go too, not only idle connections: a call stuck on the dead
   * connection keeps it in use, so evictAll() would leave it in the pool for
   * the next request to reuse. Per-request clients (React Native's per-call
   * timeout) share their base client's dispatcher and pool.
   */
  private fun resetNow(reason: String) {
    var cancelled = 0
    for (client in clients) {
      val dispatcher = client.dispatcher
      for (call in dispatcher.runningCalls() + dispatcher.queuedCalls()) {
        if (call.request().header("Upgrade").equals("websocket", ignoreCase = true)) continue
        call.cancel()
        cancelled++
      }
      client.connectionPool.evictAll()
    }
    for (delay in LATER_EVICTS_MS) {
      worker.postDelayed({ for (client in clients) client.connectionPool.evictAll() }, delay)
    }
    Log.i(TAG, "reset ($reason): cancelled $cancelled call(s), pool emptied")
  }

  private fun watchDefaultNetwork(context: Context) {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
    val callback =
      object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
          // Before API 26 there is no Handler overload: hop to the worker.
          worker.post { available(network) }
        }

        override fun onLost(network: Network) {
          worker.post { lost(network) }
        }
      }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.registerDefaultNetworkCallback(callback, worker)
      } else {
        manager.registerDefaultNetworkCallback(callback)
      }
    } catch (error: RuntimeException) {
      Log.w(TAG, "no network callback", error)
    }
  }

  private fun available(network: Network) {
    val previous = current
    current = network
    // The first callback reports the network we started on.
    if (connected && (previous == null || previous == network)) return
    changed(true, "network available")
  }

  private fun lost(network: Network) {
    if (network != current) return
    current = null
    changed(false, "network lost")
  }

  private fun changed(
    nowConnected: Boolean,
    reason: String,
  ) {
    connected = nowConnected
    resetNow(reason)
    for (listener in listeners) listener(nowConnected)
  }
}
