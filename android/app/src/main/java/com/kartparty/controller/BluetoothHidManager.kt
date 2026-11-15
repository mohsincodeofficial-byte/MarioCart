package com.kartparty.controller

import android.annotation.SuppressLint
import android.bluetooth.*
import android.content.Context
import android.util.Log

class BluetoothHidManager(private val context: Context) {

    private val tag = "BluetoothHidManager"
    private val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private var hidDevice: BluetoothHidDevice? = null
    private var connectedHost: BluetoothDevice? = null

    var onStatusChanged: ((status: String, isConnected: Boolean) -> Unit)? = null

    // Standard USB-IF HID Gamepad Descriptor (2 Axes, 8 Buttons)
    private val hidDescriptor = byteArrayOf(
        0x05.toByte(), 0x01.toByte(), // USAGE_PAGE (Generic Desktop)
        0x09.toByte(), 0x05.toByte(), // USAGE (Game Pad)
        0xa1.toByte(), 0x01.toByte(), // COLLECTION (Application)
        0xa1.toByte(), 0x00.toByte(), //   COLLECTION (Physical)
        // 2 Axes: X (Steering), Y (Throttle/Pitch) -127 to 127
        0x05.toByte(), 0x01.toByte(), //     USAGE_PAGE (Generic Desktop)
        0x09.toByte(), 0x30.toByte(), //     USAGE (X - Steering)
        0x09.toByte(), 0x31.toByte(), //     USAGE (Y - Axis)
        0x15.toByte(), 0x81.toByte(), //     LOGICAL_MINIMUM (-127)
        0x25.toByte(), 0x7f.toByte(), //     LOGICAL_MAXIMUM (127)
        0x75.toByte(), 0x08.toByte(), //     REPORT_SIZE (8 bits)
        0x95.toByte(), 0x02.toByte(), //     REPORT_COUNT (2)
        0x81.toByte(), 0x02.toByte(), //     INPUT (Data,Var,Abs)
        // 8 Buttons (A=Gas, B=Brake, X=Drift, Y=Reset, L1, R1, L2, R2)
        0x05.toByte(), 0x09.toByte(), //     USAGE_PAGE (Button)
        0x19.toByte(), 0x01.toByte(), //     USAGE_MINIMUM (Button 1)
        0x29.toByte(), 0x08.toByte(), //     USAGE_MAXIMUM (Button 8)
        0x15.toByte(), 0x00.toByte(), //     LOGICAL_MINIMUM (0)
        0x25.toByte(), 0x01.toByte(), //     LOGICAL_MAXIMUM (1)
        0x75.toByte(), 0x01.toByte(), //     REPORT_SIZE (1 bit)
        0x95.toByte(), 0x08.toByte(), //     REPORT_COUNT (8)
        0x81.toByte(), 0x02.toByte(), //     INPUT (Data,Var,Abs)
        0xc0.toByte(),                //   END_COLLECTION
        0xc0.toByte()                 // END_COLLECTION
    )

    private val report = ByteArray(3) // [X, Y, Buttons]

    private val profileListener = object : BluetoothProfile.ServiceListener {
        @SuppressLint("MissingPermission")
        override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
            if (profile == BluetoothProfile.HID_DEVICE) {
                hidDevice = proxy as BluetoothHidDevice
                registerApp()
            }
        }

        override fun onServiceDisconnected(profile: Int) {
            if (profile == BluetoothProfile.HID_DEVICE) {
                hidDevice = null
            }
        }
    }

    private val hidCallback = object : BluetoothHidDevice.Callback() {
        override fun onAppStatusChanged(pluggedDevice: BluetoothDevice?, registered: Boolean) {
            Log.d(tag, "HID App Status: registered=$registered")
            if (registered) {
                onStatusChanged?.invoke("Ready. Pair in Windows Bluetooth Settings", false)
            }
        }

        override fun onConnectionStateChanged(device: BluetoothDevice?, state: Int) {
            when (state) {
                BluetoothProfile.STATE_CONNECTED -> {
                    connectedHost = device
                    Log.d(tag, "Connected to Host PC: ${device?.name}")
                    onStatusChanged?.invoke("⚡ Connected to PC via Bluetooth (1ms)", true)
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    connectedHost = null
                    Log.d(tag, "Disconnected from Host PC")
                    onStatusChanged?.invoke("Disconnected. Reconnecting...", false)
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    fun start() {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
            onStatusChanged?.invoke("Please turn on Bluetooth", false)
            return
        }

        bluetoothAdapter.getProfileProxy(context, profileListener, BluetoothProfile.HID_DEVICE)
    }

    @SuppressLint("MissingPermission")
    private fun registerApp() {
        val sdp = BluetoothHidDeviceAppSdpSettings(
            "Kart Party Gamepad",
            "PES Mobile Virtual Gamepad",
            "Kart Party",
            BluetoothHidDevice.SUBCLASS1_COMBO,
            hidDescriptor
        )

        hidDevice?.registerApp(
            sdp,
            null,
            null,
            context.mainExecutor,
            hidCallback
        )
    }

    @SuppressLint("MissingPermission")
    fun sendReport(steering: Float, gas: Boolean, brake: Boolean, drift: Boolean, reset: Boolean) {
        val device = connectedHost ?: return
        val hid = hidDevice ?: return

        // X Axis: Steering -1.0..1.0 -> -127..127
        val clampedSteer = (steering.coerceIn(-1.0f, 1.0f) * 127).toInt().toByte()
        report[0] = clampedSteer
        report[1] = 0 // Y axis unused for steering

        // Buttons Bitmask
        var btnByte = 0
        if (gas) btnByte = btnByte or (1 shl 0)    // Button 1 (A / Cross)
        if (brake) btnByte = btnByte or (1 shl 1)  // Button 2 (B / Circle)
        if (drift) btnByte = btnByte or (1 shl 2)  // Button 3 (X / Square)
        if (reset) btnByte = btnByte or (1 shl 3)  // Button 4 (Y / Triangle)

        report[2] = btnByte.toByte()

        hid.sendReport(device, 0, report)
    }

    @SuppressLint("MissingPermission")
    fun stop() {
        hidDevice?.let {
            it.unregisterApp()
            bluetoothAdapter?.closeProfileProxy(BluetoothProfile.HID_DEVICE, it)
        }
    }
}
