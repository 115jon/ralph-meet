package expo.modules.ralphcall

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat

/**
 * Keeps the process, the microphone and the network up while a call runs
 * behind other apps or with the screen off. It does no work itself: WebRTC
 * and the sockets live in the app; this only holds the foreground state and
 * the call notification.
 */
class RalphCallService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val call = CallController.info
    if (call == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    try {
      ServiceCompat.startForeground(this, CallNotification.ID, CallNotification.build(this, call), foregroundTypes())
    } catch (error: Exception) {
      // ForegroundServiceStartNotAllowedException (12+, started from the
      // background) or SecurityException (14+, microphone not usable now).
      Log.w("RalphCall", "Could not enter the foreground", error)
      stopSelf()
    }
    // Not sticky: after the process dies there is no call to bring back.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  /**
   * microphone: capture keeps working in the background (Android 11+ cuts
   * the mic off for background apps without it). phoneCall: this is the
   * app's call (needs MANAGE_OWN_CALLS). The microphone type exists from 30.
   */
  private fun foregroundTypes(): Int =
    when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
      else -> 0
    }
}
