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
    current = this
    if (!enterForeground(call, CallController.projecting)) stopSelf()
    // Not sticky: after the process dies there is no call to bring back.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (current === this) current = null
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  /**
   * Declares (or re-declares) the foreground types. Calling startForeground
   * again on a running service replaces its types, which is how screen
   * sharing adds and drops mediaProjection without restarting the call.
   * False when Android refused: ForegroundServiceStartNotAllowedException
   * (12+, started from the background) or SecurityException (14+, the
   * microphone not usable now, or mediaProjection without the user's consent).
   */
  internal fun enterForeground(call: CallInfo, projecting: Boolean): Boolean =
    try {
      ServiceCompat.startForeground(this, CallNotification.ID, CallNotification.build(this, call), foregroundTypes(projecting))
      true
    } catch (error: Exception) {
      Log.w("RalphCall", "Could not enter the foreground (projecting=$projecting)", error)
      false
    }

  /**
   * microphone: capture keeps working in the background (Android 11+ cuts
   * the mic off for background apps without it). phoneCall: this is the
   * app's call (needs MANAGE_OWN_CALLS). mediaProjection: required by
   * MediaProjectionManager.getMediaProjection() from Android 10, and from 14
   * only allowed once the user has accepted the capture dialog. The
   * microphone type exists from 30.
   */
  private fun foregroundTypes(projecting: Boolean): Int {
    val projection = if (projecting) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0
    return when {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ->
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or projection
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or projection
      else -> 0
    }
  }

  internal companion object {
    /** The running service, so the controller can change its types. Main thread only. */
    var current: RalphCallService? = null
      private set
  }
}
