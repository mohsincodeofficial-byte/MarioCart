import { InputManager } from './input';

export class VirtualController {
  private isLeftPressed = false;
  private isRightPressed = false;
  private isGasPressed = false;
  private isBrakePressed = false;

  private isMotionEnabled = false;
  private motionAvailable = false;
  private motionStatusText = 'Off (Touch active)';

  constructor(private inputManager: InputManager) {
    this.setupTouchControls();
    this.detectMotionSupport();
  }

  private triggerHaptic(durationMs = 12): void {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(durationMs);
      } catch {
        // Ignored if user hasn't interacted or unsupported
      }
    }
  }

  private setupTouchControls(): void {
    const btnLeft = document.getElementById('btnLeft');
    const btnRight = document.getElementById('btnRight');
    const btnGas = document.getElementById('btnGas');
    const btnBrake = document.getElementById('btnBrake');

    const bindButton = (
      el: HTMLElement | null,
      onPress: () => void,
      onRelease: () => void
    ) => {
      if (!el) return;

      const handleDown = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('active');
        this.triggerHaptic(15);
        onPress();
      };

      const handleUp = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('active');
        onRelease();
      };

      el.addEventListener('pointerdown', handleDown, { passive: false });
      el.addEventListener('pointerup', handleUp, { passive: false });
      el.addEventListener('pointercancel', handleUp, { passive: false });
      el.addEventListener('pointerleave', handleUp, { passive: false });

      // Fallback for touch events
      el.addEventListener('touchstart', handleDown, { passive: false });
      el.addEventListener('touchend', handleUp, { passive: false });
      el.addEventListener('touchcancel', handleUp, { passive: false });
    };

    // Steering Left
    bindButton(
      btnLeft,
      () => {
        this.isLeftPressed = true;
        this.updateSteering();
      },
      () => {
        this.isLeftPressed = false;
        this.updateSteering();
      }
    );

    // Steering Right
    bindButton(
      btnRight,
      () => {
        this.isRightPressed = true;
        this.updateSteering();
      },
      () => {
        this.isRightPressed = false;
        this.updateSteering();
      }
    );

    // Accelerate / Gas
    bindButton(
      btnGas,
      () => {
        this.isGasPressed = true;
        this.inputManager.setThrottle(1.0);
      },
      () => {
        this.isGasPressed = false;
        this.inputManager.setThrottle(0.0);
      }
    );

    // Brake / Reverse
    bindButton(
      btnBrake,
      () => {
        this.isBrakePressed = true;
        this.inputManager.setBrake(true);
      },
      () => {
        this.isBrakePressed = false;
        this.inputManager.setBrake(false);
      }
    );
  }

  private updateSteering(): void {
    if (this.isMotionEnabled) {
      // Motion handles steering unless touch override is active
      if (this.isLeftPressed && !this.isRightPressed) {
        this.inputManager.setSteering(-1.0);
      } else if (this.isRightPressed && !this.isLeftPressed) {
        this.inputManager.setSteering(1.0);
      }
      return;
    }

    if (this.isLeftPressed && !this.isRightPressed) {
      this.inputManager.setSteering(-1.0);
    } else if (this.isRightPressed && !this.isLeftPressed) {
      this.inputManager.setSteering(1.0);
    } else {
      this.inputManager.setSteering(0.0);
    }
  }

  private detectMotionSupport(): void {
    if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
      this.motionAvailable = true;
    }
  }

  public async toggleMotionMode(): Promise<boolean> {
    if (this.isMotionEnabled) {
      this.disableMotion();
      return false;
    } else {
      return await this.enableMotion();
    }
  }

  private async enableMotion(): Promise<boolean> {
    if (!this.motionAvailable) {
      this.motionStatusText = 'Sensor unsupported on this browser';
      return false;
    }

    // iOS 13+ requires explicit permission request via user action
    const anyDeviceOrientation = DeviceOrientationEvent as any;
    if (typeof anyDeviceOrientation.requestPermission === 'function') {
      try {
        const permission = await anyDeviceOrientation.requestPermission();
        if (permission !== 'granted') {
          this.motionStatusText = 'Permission Denied';
          return false;
        }
      } catch (err) {
        console.warn('Motion permission request error:', err);
        this.motionStatusText = 'Permission Error (Requires HTTPS on some devices)';
        return false;
      }
    }

    window.addEventListener('deviceorientation', this.handleOrientation, true);
    this.isMotionEnabled = true;
    this.motionStatusText = 'Motion Steering: ACTIVE (Tilt to turn)';
    return true;
  }

  private disableMotion(): void {
    window.removeEventListener('deviceorientation', this.handleOrientation, true);
    this.isMotionEnabled = false;
    this.motionStatusText = 'Off (Touch active)';
    this.updateSteering();
  }

  private handleOrientation = (e: DeviceOrientationEvent): void => {
    if (!this.isMotionEnabled) return;

    // Check landscape vs portrait orientation
    const isLandscape = window.innerWidth > window.innerHeight;
    let tiltDegrees = 0;

    if (isLandscape) {
      // In landscape (holding phone like a steering wheel), beta represents tilt
      tiltDegrees = e.beta || 0;
      // Invert if screen orientation is reversed
      if (window.screen.orientation && window.screen.orientation.type === 'landscape-secondary') {
        tiltDegrees = -tiltDegrees;
      }
    } else {
      // In portrait, gamma represents tilt left/right (-90 to 90)
      tiltDegrees = e.gamma || 0;
    }

    // Max turning angle is approx 30 degrees tilt
    const maxTiltAngle = 30.0;
    let normalizedSteering = tiltDegrees / maxTiltAngle;

    // Deadzone to prevent jitter when holding still
    const deadzone = 0.08;
    if (Math.abs(normalizedSteering) < deadzone) {
      normalizedSteering = 0;
    } else {
      // Smooth falloff outside deadzone
      normalizedSteering = (normalizedSteering - Math.sign(normalizedSteering) * deadzone) / (1 - deadzone);
    }

    const clamped = Math.max(-1.0, Math.min(1.0, normalizedSteering));
    this.inputManager.setSteering(clamped);
  };

  public getMotionStatus(): { enabled: boolean; statusText: string } {
    return {
      enabled: this.isMotionEnabled,
      statusText: this.motionStatusText,
    };
  }
}
