import { Schema, type } from '@colyseus/schema';
import { ControllerInput, KartState } from './game-types';

export const CONSTANTS = {
  ROOM_NAME: 'kart_party',
  DEFAULT_PORT: 3000,
  SIMULATION_RATE_HZ: 60,
  SIMULATION_TIMESTEP_SEC: 1 / 60,
  CONTROLLER_SEND_RATE_HZ: 40,
  TRACK_BOUNDS: {
    minX: -36,
    maxX: 36,
    minZ: -24,
    maxZ: 24,
  },
  KART_PHYSICS: {
    maxSpeed: 22.0,           // Max forward speed in m/s (~80 km/h)
    maxReverseSpeed: 6.0,     // Max reverse speed in m/s
    acceleration: 14.0,       // m/s^2
    brakingPower: 26.0,       // m/s^2 deceleration under braking
    friction: 2.2,            // Natural rolling friction coefficient
    turnSpeed: 2.8,           // Radians per second at full steer
    minSteerSpeedThreshold: 0.1, // Minimum speed required to steer naturally
  }
};

export class KartSchema extends Schema {
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') z: number = 0;
  @type('number') rotation: number = 0;
  @type('number') speed: number = 0;

  copyFrom(state: KartState) {
    this.x = state.x;
    this.y = state.y;
    this.z = state.z;
    this.rotation = state.rotation;
    this.speed = state.speed;
  }

  toKartState(): KartState {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      rotation: this.rotation,
      speed: this.speed,
    };
  }
}

export class GameRoomStateSchema extends Schema {
  @type('number') tick: number = 0;
  @type('number') serverTime: number = 0;
  @type('number') lastAckSequence: number = 0;
  @type('boolean') controllerConnected: boolean = false;
  @type('boolean') tvConnected: boolean = false;
  @type(KartSchema) kart: KartSchema = new KartSchema();
}

/**
 * Validates untrusted controller input from the network.
 * Rejects invalid packets and clamps ranges to prevent exploits.
 */
export function validateControllerInput(input: any): ControllerInput | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const sequence = Number(input.sequence);
  if (!Number.isFinite(sequence) || sequence < 0) {
    return null;
  }

  let steering = Number(input.steering);
  if (!Number.isFinite(steering)) {
    steering = 0;
  } else {
    steering = Math.max(-1, Math.min(1, steering));
  }

  let throttle = Number(input.throttle);
  if (!Number.isFinite(throttle)) {
    throttle = 0;
  } else {
    throttle = Math.max(0, Math.min(1, throttle));
  }

  const brake = Boolean(input.brake);
  const clientTime = Number.isFinite(Number(input.clientTime)) ? Number(input.clientTime) : undefined;

  return {
    type: 'input',
    sequence: Math.floor(sequence),
    steering,
    throttle,
    brake,
    clientTime,
  };
}
