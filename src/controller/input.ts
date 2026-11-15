import { ControllerInput } from '../shared/game-types';
import { CONSTANTS, validateControllerInput } from '../shared/protocol';

export type SendInputCallback = (input: ControllerInput) => void;

export class InputManager {
  private sequence = 0;
  private currentSteering = 0;
  private currentThrottle = 0;
  private currentBrake = false;

  private isDirty = false;
  private lastSentInput: ControllerInput | null = null;
  private sendIntervalTimer: any = null;
  private dataChannel: RTCDataChannel | null = null;
  private isP2pActive = false;

  // Rate measurement
  private packetsSentInSecond = 0;
  private currentSendRateHz = 0;
  private rateIntervalTimer: any = null;
  private lastAckSequence = 0;

  constructor(private sendCallback: SendInputCallback) {}

  public setDataChannel(channel: RTCDataChannel | null): void {
    this.dataChannel = channel;
    this.isP2pActive = !!(channel && channel.readyState === 'open');
  }

  public getIsP2pActive(): boolean {
    return this.isP2pActive;
  }

  public start(): void {
    const intervalMs = Math.round(1000 / CONSTANTS.CONTROLLER_SEND_RATE_HZ);

    this.sendIntervalTimer = setInterval(() => {
      this.tick();
    }, intervalMs);

    this.rateIntervalTimer = setInterval(() => {
      this.currentSendRateHz = this.packetsSentInSecond;
      this.packetsSentInSecond = 0;
    }, 1000);
  }

  public stop(): void {
    if (this.sendIntervalTimer) clearInterval(this.sendIntervalTimer);
    if (this.rateIntervalTimer) clearInterval(this.rateIntervalTimer);
  }

  public setSteering(value: number): void {
    const clamped = Math.max(-1, Math.min(1, value));
    if (Math.abs(clamped - this.currentSteering) > 0.02) {
      this.currentSteering = clamped;
      this.isDirty = true;
    }
  }

  public setThrottle(value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    if (Math.abs(clamped - this.currentThrottle) > 0.02) {
      this.currentThrottle = clamped;
      this.isDirty = true;
    }
  }

  public setBrake(value: boolean): void {
    if (this.currentBrake !== value) {
      this.currentBrake = value;
      this.isDirty = true;
    }
  }

  public onAck(sequence: number): void {
    if (sequence > this.lastAckSequence) {
      this.lastAckSequence = sequence;
    }
  }

  public getDiagnostics(): {
    sendRateHz: number;
    lastAckSequence: number;
    currentSequence: number;
    steering: number;
    throttle: number;
    brake: boolean;
  } {
    return {
      sendRateHz: this.currentSendRateHz,
      lastAckSequence: this.lastAckSequence,
      currentSequence: this.sequence,
      steering: this.currentSteering,
      throttle: this.currentThrottle,
      brake: this.currentBrake,
    };
  }

  private tick(): void {
    const hasActiveInput =
      this.currentThrottle > 0 ||
      this.currentBrake ||
      Math.abs(this.currentSteering) > 0.02;

    // Send continuously when driving, or on change, or heartbeat every 4 ticks (~100ms)
    if (this.isDirty || hasActiveInput || (this.sequence % 4 === 0)) {
      this.sequence++;
      const payload: ControllerInput = {
        type: 'input',
        sequence: this.sequence,
        steering: Number(this.currentSteering.toFixed(2)),
        throttle: Number(this.currentThrottle.toFixed(2)),
        brake: this.currentBrake,
        clientTime: performance.now(),
      };

      const validated = validateControllerInput(payload);
      if (validated) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          try {
            this.dataChannel.send(JSON.stringify(validated));
            this.isP2pActive = true;
          } catch {
            this.isP2pActive = false;
            this.sendCallback(validated);
          }
        } else {
          this.isP2pActive = false;
          this.sendCallback(validated);
        }
        this.packetsSentInSecond++;
        this.lastSentInput = validated;
      }

      this.isDirty = false;
    }
  }
}
