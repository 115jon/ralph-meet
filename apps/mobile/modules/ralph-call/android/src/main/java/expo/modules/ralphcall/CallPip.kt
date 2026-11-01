package expo.modules.ralphcall

import android.app.Activity
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Log
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer
import java.lang.ref.WeakReference

private const val TAG = "RalphCall"

/** What JS wants in the window while the call screen shows video. */
internal data class PipConfig(
  val aspectWidth: Int,
  val aspectHeight: Int,
  val muted: Boolean,
)

/**
 * Picture-in-picture for the call screen, and its rotation. JS arms PiP only
 * while a camera or a screen share is on screen; leaving the app then shrinks
 * it into Android's PiP window (auto-enter on 12+, the user-leave hint below)
 * with Mute and Leave as remote actions, which reuse the call notification's
 * intents. Main thread only.
 */
internal object CallPip {
  /** In PiP or not; raised on every change. */
  var listener: ((Boolean) -> Unit)? = null

  private var config: PipConfig? = null
  private var activity: WeakReference<ComponentActivity>? = null

  /** The manifest's orientation, put back when the call screen locks again. */
  private var lockedOrientation: Int? = null

  private val modeListener =
    Consumer<PictureInPictureModeChangedInfo> { info ->
      listener?.invoke(info.isInPictureInPictureMode)
    }

  /** Follows the app's activity (created again after a configuration reset). */
  fun attach(next: Activity?) {
    if (next !is ComponentActivity) return
    val current = activity?.get()
    if (current === next) return
    current?.removeOnPictureInPictureModeChangedListener(modeListener)
    next.addOnPictureInPictureModeChangedListener(modeListener)
    activity = WeakReference(next)
    apply(next)
  }

  val active: Boolean
    get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity?.get()?.isInPictureInPictureMode == true

  /** Arms PiP with `next`, or disarms it with null. */
  fun configure(next: PipConfig?) {
    config = next
    activity?.get()?.let { apply(it) }
  }

  /** Below Android 12 there is no auto-enter: the home key's hint enters instead. */
  fun onUserLeaveHint(from: Activity) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S || config == null) return
    enter(from)
  }

  fun enter(from: Activity? = activity?.get()): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val target = from ?: return false
    val next = config ?: return false
    if (!supported(target)) return false
    return try {
      target.enterPictureInPictureMode(params(target, next))
    } catch (error: Exception) {
      Log.w(TAG, "Could not enter picture-in-picture", error)
      false
    }
  }

  /** Closes the PiP window (the call goes on, as with its own close key). */
  fun close() {
    val target = activity?.get() ?: return
    if (active) target.moveTaskToBack(false)
  }

  /** Lets the call screen follow the sensor, or puts the manifest's lock back. */
  fun setRotationUnlocked(unlocked: Boolean) {
    val target = activity?.get() ?: return
    if (unlocked) {
      if (lockedOrientation == null) lockedOrientation = manifestOrientation(target)
      target.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_FULL_USER
    } else {
      target.requestedOrientation = lockedOrientation ?: manifestOrientation(target)
    }
  }

  private fun manifestOrientation(target: Activity): Int =
    try {
      target.packageManager.getActivityInfo(target.componentName, 0).screenOrientation
    } catch (_: PackageManager.NameNotFoundException) {
      ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
    }

  private fun supported(target: Context): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      target.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  private fun apply(target: Activity) {
    if (!supported(target)) return
    val next = config
    try {
      if (next != null) {
        target.setPictureInPictureParams(params(target, next))
      } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        // Disarmed: no auto-enter, no actions.
        target.setPictureInPictureParams(
          PictureInPictureParams.Builder().setAutoEnterEnabled(false).setActions(emptyList()).build(),
        )
      }
    } catch (error: Exception) {
      // IllegalStateException: the activity does not declare PiP support.
      Log.w(TAG, "Could not set picture-in-picture parameters", error)
    }
  }

  private fun params(
    context: Context,
    next: PipConfig,
  ): PictureInPictureParams {
    val builder =
      PictureInPictureParams
        .Builder()
        .setAspectRatio(clampedAspect(next.aspectWidth, next.aspectHeight))
        .setActions(actions(context, next.muted))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAutoEnterEnabled(true).setSeamlessResizeEnabled(true)
    }
    return builder.build()
  }

  /** Android refuses ratios beyond 2.39:1 either way. */
  private fun clampedAspect(
    width: Int,
    height: Int,
  ): Rational {
    val w = width.coerceAtLeast(1)
    val h = height.coerceAtLeast(1)
    val ratio = w.toFloat() / h
    return when {
      ratio > 2.39f -> Rational(239, 100)
      ratio < 1 / 2.39f -> Rational(100, 239)
      else -> Rational(w, h)
    }
  }

  private fun actions(
    context: Context,
    muted: Boolean,
  ): List<RemoteAction> {
    val mute =
      RemoteAction(
        Icon.createWithResource(context, if (muted) R.drawable.ralph_call_mic_slash else R.drawable.ralph_call_mic),
        if (muted) "Unmute" else "Mute",
        if (muted) "Unmute your microphone" else "Mute your microphone",
        CallNotification.actionIntent(
          context,
          if (muted) CallNotification.ACTION_UNMUTE else CallNotification.ACTION_MUTE,
        ),
      )
    val leave =
      RemoteAction(
        Icon.createWithResource(context, R.drawable.ralph_call_phone_x),
        "Leave",
        "Leave the call",
        CallNotification.actionIntent(context, CallNotification.ACTION_HANGUP),
      )
    return listOf(mute, leave)
  }
}
