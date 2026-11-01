package expo.modules.ralphcall

import android.app.Activity
import android.content.Context
import android.os.Bundle
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/** The main activity's lifecycle, for picture-in-picture (CallPip). */
class RalphCallPackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(
      object : ReactActivityLifecycleListener {
        override fun onCreate(
          activity: Activity,
          savedInstanceState: Bundle?,
        ) = CallPip.attach(activity)

        override fun onUserLeaveHint(activity: Activity) = CallPip.onUserLeaveHint(activity)
      },
    )
}
