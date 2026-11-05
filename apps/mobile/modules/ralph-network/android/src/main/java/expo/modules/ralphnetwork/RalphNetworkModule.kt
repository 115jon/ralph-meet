package expo.modules.ralphnetwork

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS's side: network change events, and a scoped reset after a request stalls. */
class RalphNetworkModule : Module() {
  private val listener: (Boolean) -> Unit = { connected ->
    sendEvent("onNetworkChange", mapOf("connected" to connected))
  }

  override fun definition() =
    ModuleDefinition {
      Name("RalphNetwork")

      Events("onNetworkChange")

      OnStartObserving("onNetworkChange") { RalphNetwork.listeners.add(listener) }

      OnStopObserving("onNetworkChange") { RalphNetwork.listeners.remove(listener) }

      OnDestroy { RalphNetwork.listeners.remove(listener) }

      Function("isConnected") { RalphNetwork.connected }

      Function("resetRequests") { reason: String, paths: List<String> ->
        RalphNetwork.resetRequests(reason, paths)
      }
    }
}
