package expo.modules.ralphcall

import android.animation.ValueAnimator
import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.ralphnotify.Session

/**
 * The ringing screen over the lock screen (the incoming notification's
 * full-screen intent), in Talk Tree's dark ply: a silkscreen kicker, the
 * caller's square avatar inside the talk-green ring (the one loop, stopped
 * as soon as the ring ends), their name, and three large keys: Decline,
 * Message (declines, then opens the DM once unlocked) and Answer.
 *
 * Also the target of the notification's Answer, which must be an activity
 * (Android 12+ forbids notification trampolines); that start answers and
 * closes without drawing.
 */
class IncomingCallActivity : Activity() {
  private var call: IncomingCall? = null
  private var pulse: ValueAnimator? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    showOverLockScreen()
    if (!handle(intent)) return
    setContentView(buildContent(call ?: return))
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (handle(intent)) setContentView(buildContent(call ?: return))
  }

  /** False when this start only answered, or the ring is already over. */
  private fun handle(intent: Intent?): Boolean {
    val incoming = IncomingCall.from(intent?.extras)
    if (incoming == null) {
      finish()
      return false
    }
    if (intent?.action?.endsWith(".$ACTION_ANSWER") == true) {
      IncomingCalls.answer(this, incoming.callId, fromApp = false)
      finish()
      return false
    }
    if (IncomingCalls.current?.callId != incoming.callId) {
      finish()
      return false
    }
    call = incoming
    IncomingCalls.screen = this
    return true
  }

  override fun onDestroy() {
    pulse?.cancel()
    pulse = null
    if (IncomingCalls.screen === this) IncomingCalls.screen = null
    super.onDestroy()
  }

  /** The ring ended (answered, declined, missed, elsewhere). */
  internal fun finishRing() {
    runOnUiThread {
      pulse?.cancel()
      finish()
    }
  }

  private fun showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  private fun decline() {
    val current = call ?: return
    IncomingCalls.decline(this, current.callId)
    finish()
  }

  private fun answer() {
    val current = call ?: return
    IncomingCalls.answer(this, current.callId, fromApp = false)
  }

  /** Decline, then the DM once the phone is unlocked, to write instead. */
  private fun message() {
    val current = call ?: return
    IncomingCalls.decline(this, current.callId)
    val session = Session.load(this)
    val open = {
      if (session != null) {
        val uri = Uri.Builder().scheme(session.scheme).authority("dm").appendPath(current.channelId).build()
        startActivity(
          Intent(Intent.ACTION_VIEW, uri)
            .setPackage(packageName)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
      }
      finish()
    }
    val keyguard = getSystemService(KeyguardManager::class.java)
    if (keyguard?.isKeyguardLocked == true && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      keyguard.requestDismissKeyguard(
        this,
        object : KeyguardManager.KeyguardDismissCallback() {
          override fun onDismissSucceeded() = open()

          override fun onDismissCancelled() = finish()

          override fun onDismissError() = finish()
        },
      )
    } else {
      open()
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  private fun buildContent(call: IncomingCall): View {
    val root =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setBackgroundColor(PLY0)
        setPadding(dp(24), dp(72), dp(24), dp(56))
      }
    root.addView(silk("Yap · Voice call", INK3))
    root.addView(space(40))
    root.addView(avatar(call), LinearLayout.LayoutParams(dp(208), dp(208)))
    root.addView(space(28))
    root.addView(
      TextView(this).apply {
        text = call.callerName
        setTextColor(INK1)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 32f)
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
        letterSpacing = -0.02f
        maxLines = 1
        ellipsize = TextUtils.TruncateAt.END
        gravity = Gravity.CENTER
      },
    )
    root.addView(space(10))
    root.addView(
      LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(
          View(context).apply { background = square(IDLE, 1f) },
          LinearLayout.LayoutParams(dp(8), dp(8)).apply { marginEnd = dp(8) },
        )
        addView(silk("Incoming call", INK2))
      },
      LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT),
    )
    root.addView(View(this), LinearLayout.LayoutParams(0, 0, 1f))
    root.addView(
      LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER
        addView(key("Decline", R.drawable.ralph_call_phone_x, DANGER, ON_DANGER, null) { decline() }, keySlot())
        addView(key("Message", R.drawable.ralph_call_message, PLY3, INK1, LINE) { message() }, keySlot())
        addView(key("Answer", R.drawable.ralph_call_phone, TALK, ON_TALK, null) { answer() }, keySlot())
      },
      LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT),
    )
    return root
  }

  private fun avatar(call: IncomingCall): View {
    val size = dp(176)
    val inner = dp(148)
    // Room around the ring for its pulse to grow into without clipping.
    val frame =
      FrameLayout(this).apply {
        setPadding(dp(16), dp(16), dp(16), dp(16))
        clipToPadding = false
      }
    val ring = View(this).apply { background = square(Color.TRANSPARENT, 4f, stroke = TALK) }
    frame.addView(ring, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
    val still = View(this).apply { background = square(Color.TRANSPARENT, 4f, stroke = TALK_DIM) }
    frame.addView(still, FrameLayout.LayoutParams(size, size, Gravity.CENTER))
    val bitmap = IncomingCalls.currentAvatar
    val face: View =
      if (bitmap != null) {
        ImageView(this).apply {
          setImageBitmap(bitmap)
          scaleType = ImageView.ScaleType.CENTER_CROP
          clipToOutline = true
          background = square(PLY4, 3f, stroke = LINE)
        }
      } else {
        TextView(this).apply {
          text = call.callerName.take(1).uppercase()
          setTextColor(INK1)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 56f)
          typeface = Typeface.create("sans-serif", Typeface.BOLD)
          gravity = Gravity.CENTER
          background = square(PLY4, 3f, stroke = LINE)
        }
      }
    frame.addView(face, FrameLayout.LayoutParams(inner, inner, Gravity.CENTER))
    pulse =
      ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1400
        repeatCount = ValueAnimator.INFINITE
        interpolator = DecelerateInterpolator()
        addUpdateListener {
          val t = it.animatedValue as Float
          ring.alpha = 0.8f * (1f - t)
          ring.scaleX = 1f + 0.14f * t
          ring.scaleY = 1f + 0.14f * t
        }
        // Reduced motion: the still ring alone.
        val animate = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ValueAnimator.areAnimatorsEnabled()
        if (animate) start() else ring.visibility = View.GONE
      }
    return frame
  }

  private fun key(
    label: String,
    icon: Int,
    fill: Int,
    ink: Int,
    stroke: Int?,
    onPress: () -> Unit,
  ): View {
    val column =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
      }
    val button =
      ImageView(this).apply {
        setImageResource(icon)
        setColorFilter(ink)
        scaleType = ImageView.ScaleType.CENTER
        background = square(fill, 4f, stroke)
        contentDescription = label
        isClickable = true
        isFocusable = true
        setOnClickListener { onPress() }
        setPadding(dp(22), dp(22), dp(22), dp(22))
      }
    column.addView(button, LinearLayout.LayoutParams(dp(72), dp(72)))
    column.addView(
      TextView(this).apply {
        text = label
        setTextColor(INK2)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        gravity = Gravity.CENTER
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
      },
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ).apply { topMargin = dp(10) },
    )
    return column
  }

  private fun keySlot() = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)

  /** Silkscreen: the mono face, uppercase, tracked out. */
  private fun silk(
    text: String,
    color: Int,
  ) = TextView(this).apply {
    this.text = text.uppercase()
    setTextColor(color)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
    typeface = Typeface.MONOSPACE
    letterSpacing = 0.12f
  }

  private fun space(heightDp: Int) =
    View(this).apply {
      layoutParams = LinearLayout.LayoutParams(1, dp(heightDp))
    }

  private fun square(
    fill: Int,
    radiusDp: Float,
    stroke: Int? = null,
  ) = GradientDrawable().apply {
    setColor(fill)
    cornerRadius = radiusDp * resources.displayMetrics.density
    if (stroke != null) setStroke(dp(if (stroke == TALK || stroke == TALK_DIM) 2 else 1), stroke)
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  internal companion object {
    const val ACTION_SHOW = "ring"
    const val ACTION_ANSWER = "answer"

    // Talk Tree dark (src/styles/tokens.css): the ringing screen is always
    // dark, like the lock screen it covers.
    private val PLY0 = Color.parseColor("#000000")
    private val PLY3 = Color.parseColor("#1b1b1f")
    private val PLY4 = Color.parseColor("#232328")
    private val INK1 = Color.parseColor("#f2f2f3")
    private val INK2 = Color.parseColor("#b4b4ba")
    private val INK3 = Color.parseColor("#8b8b92")
    private val LINE = Color.parseColor("#2c2c31")
    private val TALK = Color.parseColor("#3ddc84")
    private val TALK_DIM = Color.parseColor("#4D3DDC84")
    private val ON_TALK = Color.parseColor("#000000")
    private val DANGER = Color.parseColor("#d4343a")
    private val ON_DANGER = Color.parseColor("#ffffff")
    private val IDLE = Color.parseColor("#f5b83d")
  }
}
