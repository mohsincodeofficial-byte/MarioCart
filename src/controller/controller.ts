import { InputManager } from './input';

export class VirtualController {
  private isGasPressed = false;
  private isBrakePressed = false;
  private isDriftPressed = false;
  private onResetCallback: (() => void) | null = null;

  // PES Mobile Movable Dynamic Stick State
  private activePointerId: number | null = null;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private maxRadius = 46; // PES mobile travel radius

  private stickBaseEl: HTMLElement | null = null;
  private stickPuckEl: HTMLElement | null = null;
  private touchZoneLeftEl: HTMLElement | null = null;

  private deferredInstallPrompt: any = null;

  constructor(private inputManager: InputManager) {
    this.stickBaseEl = document.getElementById('pesStickBase');
    this.stickPuckEl = document.getElementById('pesStickPuck');
    this.touchZoneLeftEl = document.getElementById('touchZoneLeft');

    this.setupPesDynamicStick();
    this.setupPesActionButtons();
    this.setupNativeAppInstall();
    this.setupBluetoothAction();
    this.setupFullscreenButton();
  }

  public setOnReset(cb: () => void): void {
    this.onResetCallback = cb;
  }

  public triggerHaptic(pattern: number | number[] = 12): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {}
    }
  }

  /**
   * PES Mobile (eFootball) Floating Dynamic Analog Stick:
   * Spawns right under the user's thumb wherever touched on the left half of the display.
   */
  private setupPesDynamicStick(): void {
    if (!this.touchZoneLeftEl || !this.stickBaseEl || !this.stickPuckEl) return;

    const handlePointerDown = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (this.activePointerId !== null) return; // already tracking primary thumb
      this.activePointerId = e.pointerId;

      try {
        this.touchZoneLeftEl?.setPointerCapture(e.pointerId);
      } catch {}

      // Spawn stick base directly at thumb touch location!
      const rect = this.touchZoneLeftEl!.getBoundingClientRect();
      this.stickOriginX = e.clientX;
      this.stickOriginY = e.clientY;

      // Position relative to touchZone container
      const relX = this.stickOriginX - rect.left;
      const relY = this.stickOriginY - rect.top;

      this.stickBaseEl!.style.left = `${relX}px`;
      this.stickBaseEl!.style.top = `${relY}px`;
      this.stickBaseEl!.classList.add('active');

      this.stickPuckEl!.style.transition = 'none';
      this.stickPuckEl!.style.transform = 'translate(0px, 0px)';

      this.triggerHaptic(10);
      this.processStickMove(e.clientX, e.clientY);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointerId) return;
      e.preventDefault();
      this.processStickMove(e.clientX, e.clientY);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== this.activePointerId) return;
      e.preventDefault();
      this.activePointerId = null;

      // Reset puck to center with smooth spring return
      this.stickPuckEl!.style.transition = 'transform 0.1s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      this.stickPuckEl!.style.transform = 'translate(0px, 0px)';
      this.stickBaseEl!.classList.remove('active');

      this.inputManager.setSteering(0.0);
    };

    this.touchZoneLeftEl.addEventListener('pointerdown', handlePointerDown, { passive: false });
    this.touchZoneLeftEl.addEventListener('pointermove', handlePointerMove, { passive: false });
    this.touchZoneLeftEl.addEventListener('pointerup', handlePointerUp, { passive: false });
    this.touchZoneLeftEl.addEventListener('pointercancel', handlePointerUp, { passive: false });
  }

  private processStickMove(clientX: number, clientY: number): void {
    const dx = clientX - this.stickOriginX;
    const dy = clientY - this.stickOriginY;
    const distance = Math.hypot(dx, dy);

    let clampedDx = dx;
    let clampedDy = dy;
    if (distance > this.maxRadius) {
      const ratio = this.maxRadius / distance;
      clampedDx = dx * ratio;
      clampedDy = dy * ratio;
    }

    this.stickPuckEl!.style.transform = `translate(${clampedDx}px, ${clampedDy}px)`;

    // PES horizontal axis maps to granular analog steering (-1.0 to 1.0)
    const normalizedSteering = clampedDx / this.maxRadius;
    this.inputManager.setSteering(normalizedSteering);
  }

  /**
   * Big PES Mobile Action Buttons (Dash/Gas, Matchup/Brake, Drift)
   */
  private setupPesActionButtons(): void {
    const btnGas = document.getElementById('btnGas');
    const btnBrake = document.getElementById('btnBrake');
    const btnDrift = document.getElementById('btnDrift');
    const btnReset = document.getElementById('btnReset');

    const bindButton = (
      el: HTMLElement | null,
      onPress: () => void,
      onRelease: () => void,
      hapticDuration = 14
    ) => {
      if (!el) return;

      const handleDown = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('active');
        if (e instanceof PointerEvent && el.setPointerCapture) {
          try { el.setPointerCapture(e.pointerId); } catch {}
        }
        this.triggerHaptic(hapticDuration);
        onPress();
      };

      const handleUp = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('active');
        if (e instanceof PointerEvent && el.releasePointerCapture) {
          try { el.releasePointerCapture(e.pointerId); } catch {}
        }
        onRelease();
      };

      el.addEventListener('pointerdown', handleDown, { passive: false });
      el.addEventListener('pointerup', handleUp, { passive: false });
      el.addEventListener('pointercancel', handleUp, { passive: false });
    };

    // DASH / SPRINT (GAS)
    bindButton(
      btnGas,
      () => {
        this.isGasPressed = true;
        this.inputManager.setThrottle(1.0);
      },
      () => {
        this.isGasPressed = false;
        this.inputManager.setThrottle(0.0);
      },
      14
    );

    // MATCH-UP / REVERSE (BRAKE)
    bindButton(
      btnBrake,
      () => {
        this.isBrakePressed = true;
        this.inputManager.setBrake(true);
      },
      () => {
        this.isBrakePressed = false;
        this.inputManager.setBrake(false);
      },
      25
    );

    // DRIFT
    bindButton(
      btnDrift,
      () => {
        this.isDriftPressed = true;
        this.inputManager.setBrake(true);
      },
      () => {
        this.isDriftPressed = false;
        this.inputManager.setBrake(false);
      },
      20
    );

    // RESET KART
    bindButton(
      btnReset,
      () => {
        this.triggerHaptic([20, 50, 20]);
        if (this.onResetCallback) this.onResetCallback();
      },
      () => {},
      30
    );
  }

  /**
   * Native Android PWA Installation: Allows the user to install the controller as a standalone Android app.
   */
  private setupNativeAppInstall(): void {
    const installBtn = document.getElementById('btnInstallApp');
    if (!installBtn) return;

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      installBtn.style.display = 'flex';
      console.log('[Native App] Installation prompt ready.');
    });

    installBtn.addEventListener('click', async () => {
      this.triggerHaptic(15);
      if (this.deferredInstallPrompt) {
        this.deferredInstallPrompt.prompt();
        const { outcome } = await this.deferredInstallPrompt.userChoice;
        console.log(`[Native App] Installation outcome: ${outcome}`);
        this.deferredInstallPrompt = null;
        if (outcome === 'accepted') {
          installBtn.style.display = 'none';
        }
      } else {
        alert('To install: Tap your browser menu (⋮) and tap "Add to Home Screen" or "Install App"!');
      }
    });

    window.addEventListener('appinstalled', () => {
      console.log('[Native App] Kart Controller installed successfully!');
      installBtn.style.display = 'none';
    });
  }

  /**
   * Direct Bluetooth Pairing Action (Web Bluetooth)
   */
  private setupBluetoothAction(): void {
    const btBtn = document.getElementById('btnBluetooth');
    if (!btBtn) return;

    btBtn.addEventListener('click', async () => {
      this.triggerHaptic(18);
      const anyNav = navigator as any;

      if (!anyNav.bluetooth) {
        alert('Bluetooth Radio Pairing:\n\n1. On PC, open Bluetooth settings.\n2. Tap "Add device" and select your OnePlus 15.\n3. Your phone will directly communicate as a low-latency controller!');
        return;
      }

      try {
        console.log('[Bluetooth] Requesting Bluetooth device scan...');
        const device = await anyNav.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['generic_access', 'battery_service'],
        });
        console.log(`[Bluetooth] Paired with device: ${device.name} (${device.id})`);
        btBtn.textContent = `🔵 ${device.name || 'BT Connected'}`;
        btBtn.style.borderColor = '#00e5ff';
      } catch (err: any) {
        if (err.name !== 'NotFoundError') {
          console.warn('[Bluetooth] Pairing notice:', err);
        }
      }
    });
  }

  private setupFullscreenButton(): void {
    const fsBtn = document.getElementById('btnFullscreen');
    if (!fsBtn) return;

    fsBtn.addEventListener('click', () => {
      this.triggerHaptic(15);
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }
}
