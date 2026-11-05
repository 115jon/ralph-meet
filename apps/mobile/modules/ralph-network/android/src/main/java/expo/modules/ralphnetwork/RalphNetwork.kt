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
 * - When the default network changes or is lost, every HTTP call in flight
 *   is cancelled and the pool is emptied, so the next request opens a fresh
 *   connection on the network that works. A browser does the same
 *   (ERR_NETWORK_CHANGED). WebSockets are left alone: their owners probe
 *   them and decide.
 * - When JS reports a request that stalled with no network change (a socket
 *   ticket that got no answer), only the calls to the paths it names are
 *   cancelled, and idle connections are evicted now and a moment later.
 *   The connection may only be slow (an upload filling the uplink), so
 *   other calls on it (uploads, image loads) carry on. A dead connection
 *   that still carries one of them is retired by OkHttp itself: its read or
 *   write timeout fails the call and pings the connection, and a connection
 *   that misses the pong is not reused.
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

  /** Seeded in [install] from the launch network; then changed on the worker thread only. */
  @Volatile private var state = DefaultNetworkState<Network>(initiallyConnected = true)

  /** False while Android reports no default network (also after an offline launch). */
  val connected: Boolean
    get() = state.connected

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

  /**
   * Cancels the HTTP calls in flight to [paths] (never WebSockets) and
   * evicts idle pooled connections, now and a moment later. Any thread.
   */
  fun resetRequests(
    reason: String,
    paths: Collection<String>,
  ) {
    val only = paths.toSet()
    worker.post { resetNow(reason, only) }
  }

  /**
   * The calls go too, not only idle connections: a call stuck on the dead
   * connection keeps it in use, so evictAll() would leave it in the pool for
   * the next request to reuse. Per-request clients (React Native's per-call
   * timeout) share their base client's dispatcher and pool.
   *
   * [onlyPaths]: cancel only calls to these paths; null cancels every call.
   */
  private fun resetNow(
    reason: String,
    onlyPaths: Set<String>? = null,
  ) {
    var cancelled = 0
    for (client in clients) {
      val dispatcher = client.dispatcher
      for (call in dispatcher.runningCalls() + dispatcher.queuedCalls()) {
        val request = call.request()
        if (!cancelsCall(request.url.encodedPath, request.header("Upgrade"), onlyPaths)) continue
        call.cancel()
        cancelled++
      }
      client.connectionPool.evictAll()
    }
    for (delay in LATER_EVICTS_MS) {
      worker.postDelayed({ for (client in clients) client.connectionPool.evictAll() }, delay)
    }
    Log.i(TAG, "reset ($reason): cancelled $cancelled call(s), idle connections evicted")
  }

  private fun watchDefaultNetwork(context: Context) {
    val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
    // Launched offline: no callback comes until a network does, and that
    // one must be reported as a change.
    val launchedOnline =
      try {
        manager.activeNetwork != null
      } catch (error: RuntimeException) {
        true
      }
    state = DefaultNetworkState(launchedOnline)
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
    // The first callback reports the network we started on.
    if (state.available(network)) changed(true, "network available")
  }

  private fun lost(network: Network) {
    if (state.lost(network)) changed(false, "network lost")
  }

  private fun changed(
    nowConnected: Boolean,
    reason: String,
  ) {
    resetNow(reason)
    for (listener in listeners) listener(nowConnected)
  }
}
