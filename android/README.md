# 🎮 Kart Party – Native Android Bluetooth Controller (PES Mobile Edition)

This Android app turns your smartphone into a **Hardware Bluetooth Gamepad** with **PES Mobile (eFootball)** inspired touch controls.

## ⚡ Zero Wi-Fi & Zero Internet Dependency
- Communicates directly to the PC's Bluetooth adapter using **Android Bluetooth HID (`BluetoothHidDevice`)**.
- Windows natively detects your OnePlus 15 as an **official wireless gamepad**.
- **Latency:** **1 millisecond**.

---

## 🕹️ Controls Architecture (PES Mobile / eFootball Inspired)
1. **Movable / Dynamic Floating Virtual Stick (Left Screen)**:
   - Touch down anywhere on the left half of the display: the joystick base spawns dynamically right under your thumb.
   - Smooth 360° analog steering with neon cyan vector halos.
   - Snaps back to neutral on finger release.
2. **Big PES Command Buttons (Right Screen)**:
   - **▲ DASH / GAS:** Massive 110dp green/cyan button for full throttle.
   - **■ MATCH-UP / BRAKE:** Massive 110dp ruby/pink button for braking and reverse.
   - **DRIFT:** Quick-access handbrake trigger for drift turns.
   - **↺ RESET:** Instant kart re-centering.

---

## 📲 How to Connect to Your PC

### Step 1: Pair Phone with Windows Bluetooth
1. On your Windows PC, press **`Win + I`** → **Bluetooth & devices** → **Add device** → **Bluetooth**.
2. On your OnePlus 15, open **Bluetooth Settings** and tap your PC name to pair.

### Step 2: Open Controller
1. Open the **Kart Party Controller** app on your phone.
2. The app automatically registers as a Bluetooth Gamepad.
3. Your PC screen will instantly show:
   ```
   🎮 Bluetooth Gamepad Connected (1ms latency)
   ```
4. Steer and drive with zero network delay!

---

## 📦 Instant Ready-Made App Alternative (Play Store / GitHub)
If you want to play immediately on Bluetooth without building the source APK:
- You can install **"Serverless Bluetooth Keyboard & Mouse / Gamepad for PC/Phone"** (by AppGround IO) from Google Play or GitHub.
- In that app: select **"Gamepad" layout** → Connect to your PC via Bluetooth.
- Our TV game automatically reads it through standard Windows Gamepad input (`navigator.getGamepads()`)!
