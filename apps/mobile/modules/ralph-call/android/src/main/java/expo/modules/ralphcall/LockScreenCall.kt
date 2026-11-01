package expo.modules.ralphcall

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import java.lang.ref.WeakReference

/**
 * A call answered on the lock screen goes on over it, like the dialer's:
 * while armed, the app's activities show over the keyguard (and wake the
 * screen) without the user unlocking. Disarmed when the call ends, after
 * which the app is behind the lock screen again. Main thread only.
 */
internal object LockScreenCall {
  private var registered = false
  private var armed = false
  private val activities = mutableListOf<WeakReference<Activity>>()

  private val callbacks =
    object : Application.ActivityLifecycleCallbacks {
      override fun onActivityCreated(
        activity: Activity,
        savedInstanceState: Bundle?,
      ) = track(activity)

      // An activity that existed before the call was armed (the app was
      // open behind the lock screen) is caught as it comes to the front.
      override fun onActivityStarted(activity: Activity) = track(activity)

      override fun onActivityDestroyed(activity: Activity) {
        activities.removeAll { it.get() == null || it.get() === activity }
      }

      override fun onActivityResumed(activity: Activity) = Unit

      override fun onActivityPaused(activity: Activity) = Unit

      override fun onActivityStopped(activity: Activity) = Unit

      override fun onActivitySaveInstanceState(
        activity: Activity,
        outState: Bundle,
      ) = Unit
    }

  fun track(activity: Activity) {
    if (activity is IncomingCallActivity) return
    if (activities.none { it.get() === activity }) activities.add(WeakReference(activity))
    if (armed) show(activity, true)
  }

  /** Registers early (the module's creation) so running activities are known. */
  fun register(context: Context) {
    if (registered) return
    val app = context.applicationContext as? Application ?: return
    app.registerActivityLifecycleCallbacks(callbacks)
    registered = true
  }

  fun arm(context: Context) {
    register(context)
    armed = true
    for (ref in activities) ref.get()?.let { show(it, true) }
  }

  fun disarm() {
    if (!armed) return
    armed = false
    for (ref in activities) ref.get()?.let { show(it, false) }
  }

  private fun show(
    activity: Activity,
    over: Boolean,
  ) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      activity.setShowWhenLocked(over)
      activity.setTurnScreenOn(over)
    } else {
      @Suppress("DEPRECATION")
      val flags =
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      if (over) activity.window.addFlags(flags) else activity.window.clearFlags(flags)
    }
  }
}
