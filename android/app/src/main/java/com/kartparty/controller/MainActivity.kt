package com.kartparty.controller

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat

class MainActivity : AppCompatActivity() {

    private lateinit var bluetoothHidManager: BluetoothHidManager
    private lateinit var tvStatus: TextView
    private lateinit var pesStickView: PesTouchPadView

    private var currentSteer = 0f
    private var isGas = false
    private var isBrake = false
    private var isDrift = false
    private var isReset = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        hideSystemUI()

        tvStatus = findViewById(R.id.tvStatus)
        pesStickView = findViewById(R.id.pesStickView)

        bluetoothHidManager = BluetoothHidManager(this)
        bluetoothHidManager.onStatusChanged = { status, isConnected ->
            runOnUiThread {
                tvStatus.text = status
                if (isConnected) {
                    tvStatus.setTextColor(android.graphics.Color.parseColor("#38bdf8"))
                } else {
                    tvStatus.setTextColor(android.graphics.Color.parseColor("#4ade80"))
                }
            }
        }

        // Check Permissions for Bluetooth
        requestBluetoothPermissions()

        // 1. Hook PES Floating Joystick
        pesStickView.onSteerChanged = { steer ->
            currentSteer = steer
            sendCurrentState()
        }

        // 2. Hook Big Action Buttons
        val btnGas = findViewById<Button>(R.id.btnGas)
        val btnBrake = findViewById<Button>(R.id.btnBrake)
        val btnDrift = findViewById<Button>(R.id.btnDrift)
        val btnReset = findViewById<Button>(R.id.btnReset)

        bindTouchButton(btnGas) { pressed -> isGas = pressed }
        bindTouchButton(btnBrake) { pressed -> isBrake = pressed }
        bindTouchButton(btnDrift) { pressed -> isDrift = pressed }
        bindTouchButton(btnReset) { pressed -> isReset = pressed }
    }

    private fun bindTouchButton(button: Button, onStateChange: (Boolean) -> Unit) {
        button.setOnTouchListener { v, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    onStateChange(true)
                    v.animate().scaleX(0.92f).scaleY(0.92f).setDuration(50).start()
                    sendCurrentState()
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    onStateChange(false)
                    v.animate().scaleX(1.0f).scaleY(1.0f).setDuration(50).start()
                    sendCurrentState()
                    true
                }
                else -> false
            }
        }
    }

    private fun sendCurrentState() {
        bluetoothHidManager.sendReport(currentSteer, isGas, isBrake, isDrift, isReset)
    }

    private fun requestBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val permissions = arrayOf(
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_ADVERTISE
            )
            val needed = permissions.filter {
                ActivityCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
            }
            if (needed.isNotEmpty()) {
                ActivityCompat.requestPermissions(this, needed.toTypedArray(), 101)
            } else {
                bluetoothHidManager.start()
            }
        } else {
            bluetoothHidManager.start()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 101 && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) {
            bluetoothHidManager.start()
        }
    }

    private fun hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
            )
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        bluetoothHidManager.stop()
    }
}
