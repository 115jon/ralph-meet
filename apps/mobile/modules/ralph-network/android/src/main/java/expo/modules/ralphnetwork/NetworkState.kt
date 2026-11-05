package expo.modules.ralphnetwork

/**
 * The default network as ConnectivityManager's callbacks report it. Generic
 * over the network handle so it runs on the JVM in unit tests.
 *
 * [connected] starts from the network the app launched on (none when it
 * launched offline). The first [available] for that network is not a change;
 * after an offline launch it is.
 */
internal class DefaultNetworkState<N : Any>(
  initiallyConnected: Boolean,
) {
  @Volatile var connected: Boolean = initiallyConnected
    private set

  private var current: N? = null

  /** A default network is available. True if that is a change to report. */
  fun available(network: N): Boolean {
    val previous = current
    current = network
    if (connected && (previous == null || previous == network)) return false
    connected = true
    return true
  }

  /** A network was lost. True if it was the default one. */
  fun lost(network: N): Boolean {
    if (network != current) return false
    current = null
    connected = false
    return true
  }
}

/**
 * Whether a reset cancels this call. WebSockets never: their owners probe
 * them and decide. With [onlyPaths] (a reset JS asked for after a request
 * stalled) only calls to those paths: an upload or an image load on a slow
 * but working connection must not fail because a ticket request did.
 */
internal fun cancelsCall(
  path: String,
  upgradeHeader: String?,
  onlyPaths: Collection<String>?,
): Boolean {
  if (upgradeHeader.equals("websocket", ignoreCase = true)) return false
  return onlyPaths == null || path in onlyPaths
}
