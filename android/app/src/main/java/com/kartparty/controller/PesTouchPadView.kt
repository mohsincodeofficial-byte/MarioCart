package com.kartparty.controller

import android.content.Context
import android.graphics.*
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot
import kotlin.math.min

class PesTouchPadView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator

    // Floating Joystick Coordinates
    private var isStickActive = false
    private var originX = 0f
    private var originY = 0f
    private var puckX = 0f
    private var puckY = 0f

    private val baseRadius = 140f
    private val puckRadius = 65f
    private val maxTravelRadius = 110f

    var onSteerChanged: ((steering: Float) -> Unit)? = null

    // Paint Styles (PES Neon Cyan & Obsidian Arena Aesthetics)
    private val basePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.parseColor("#1500e5ff")
    }

    private val baseRingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 5f
        color = Color.parseColor("#00e5ff")
        setShadowLayer(25f, 0f, 0f, Color.parseColor("#00e5ff"))
    }

    private val dashedRingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
        color = Color.parseColor("#40ffffff")
        pathEffect = DashPathEffect(floatArrayOf(15f, 15f), 0f)
    }

    private val puckPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.parseColor("#1a2233")
    }

    private val puckBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 4f
        color = Color.parseColor("#00e5ff")
    }

    private val puckCorePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = Color.parseColor("#00e5ff")
    }

    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#44ffffff")
        textSize = 34f
        textAlign = Paint.Align.LEFT
    }

    private fun triggerHapticTick() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            vibrator?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
        } else {
            vibrator?.vibrate(12)
        }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        if (!isStickActive) {
            // Idle hint in left corner
            canvas.drawText("TOUCH ANYWHERE TO STEER (PES MODE)", 60f, height - 60f, textPaint)
            return
        }

        // 1. Draw PES Glowing Joystick Base
        canvas.drawCircle(originX, originY, baseRadius, basePaint)
        canvas.drawCircle(originX, originY, baseRadius, baseRingPaint)
        canvas.drawCircle(originX, originY, baseRadius * 0.75f, dashedRingPaint)

        // 2. Draw Movable Thumb Puck
        canvas.drawCircle(puckX, puckY, puckRadius, puckPaint)
        canvas.drawCircle(puckX, puckY, puckRadius, puckBorderPaint)
        canvas.drawCircle(puckX, puckY, 20f, puckCorePaint)
    }

    override fun onTouchEvent(event: MotionEvent): MotionEvent? {
        val x = event.x
        val y = event.y

        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                // PES Mobile Feature: Joystick dynamically spawns right under the thumb!
                isStickActive = true
                originX = x
                originY = y
                puckX = x
                puckY = y
                triggerHapticTick()
                invalidate()
                return null
            }
            MotionEvent.ACTION_MOVE -> {
                if (isStickActive) {
                    val dx = x - originX
                    val dy = y - originY
                    val distance = hypot(dx.toDouble(), dy.toDouble()).toFloat()

                    if (distance > maxTravelRadius) {
                        val ratio = maxTravelRadius / distance
                        puckX = originX + dx * ratio
                        puckY = originY + dy * ratio
                    } else {
                        puckX = x
                        puckY = y
                    }

                    // Normalize horizontal deflection to steering (-1.0 to 1.0)
                    val rawSteer = ((puckX - originX) / maxTravelRadius).coerceIn(-1.0f, 1.0f)
                    onSteerChanged?.invoke(rawSteer)
                    invalidate()
                }
                return null
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                isStickActive = false
                puckX = originX
                puckY = originY
                onSteerChanged?.invoke(0.0f)
                invalidate()
                return null
            }
        }
        return super.onTouchEvent(event) as MotionEvent?
    }
}
