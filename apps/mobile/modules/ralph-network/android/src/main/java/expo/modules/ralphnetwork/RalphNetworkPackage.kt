package expo.modules.ralphnetwork

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/**
 * Installs the HTTP client factory in Application.onCreate, before React
 * Native's networking module asks for its client.
 */
class RalphNetworkPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(
      object : ApplicationLifecycleListener {
        override fun onCreate(application: Application) = RalphNetwork.install(application)
      },
    )
}
