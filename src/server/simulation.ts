import RAPIER from '@dimforge/rapier3d-compat';
import { CONSTANTS } from '../shared/protocol';
import { ControllerInput, KartState } from '../shared/game-types';

export class KartSimulation {
  private world!: RAPIER.World;
  private kartBody!: RAPIER.RigidBody;
  private isInitialized = false;

  private state: KartState = {
    x: 0,
    y: 0.25,
    z: 0,
    rotation: 0,
    speed: 0,
  };

  private lastInput: ControllerInput = {
    type: 'input',
    sequence: 0,
    steering: 0,
    throttle: 0,
    brake: false,
  };

  private lastAckSequence = 0;
  private tickCount = 0;

  async init(): Promise<void> {
    await RAPIER.init();

    // Create 3D physics world
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    // Create ground collider
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(50.0, 0.5, 50.0)
      .setTranslation(0.0, -0.5, 0.0);
    this.world.createCollider(groundColliderDesc);

    // Create 4 perimeter wall colliders for the track bounds
    const { minX, maxX, minZ, maxZ } = CONSTANTS.TRACK_BOUNDS;
    const wallHeight = 2.0;
    const wallThickness = 1.0;

    // North wall (+Z)
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid((maxX - minX) / 2 + wallThickness, wallHeight, wallThickness)
        .setTranslation(0, wallHeight, maxZ + wallThickness)
    );
    // South wall (-Z)
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid((maxX - minX) / 2 + wallThickness, wallHeight, wallThickness)
        .setTranslation(0, wallHeight, minZ - wallThickness)
    );
    // East wall (+X)
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(wallThickness, wallHeight, (maxZ - minZ) / 2 + wallThickness)
        .setTranslation(maxX + wallThickness, wallHeight, 0)
    );
    // West wall (-X)
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(wallThickness, wallHeight, (maxZ - minZ) / 2 + wallThickness)
        .setTranslation(minX - wallThickness, wallHeight, 0)
    );

    // Create Kart RigidBody (kinematic position-based with cuboid collider)
    const kartBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(this.state.x, this.state.y, this.state.z);
    this.kartBody = this.world.createRigidBody(kartBodyDesc);

    // Kart collider: 1.2m width, 0.6m height, 2.0m length (half-extents: 0.6, 0.3, 1.0)
    const kartColliderDesc = RAPIER.ColliderDesc.cuboid(0.6, 0.3, 1.0);
    this.world.createCollider(kartColliderDesc, this.kartBody);

    this.isInitialized = true;
    console.log(`[Simulation] Rapier physics world & colliders initialized successfully.`);
  }

  private lastInputTime = Date.now();

  applyInput(input: ControllerInput): void {
    if (input.sequence > this.lastAckSequence) {
      this.lastAckSequence = input.sequence;
      this.lastInput = input;
      this.lastInputTime = Date.now();
    }
  }

  clearInput(): void {
    this.lastInput = {
      type: 'input',
      sequence: this.lastAckSequence,
      steering: 0,
      throttle: 0,
      brake: false,
    };
    this.lastInputTime = Date.now();
  }

  step(dt: number = CONSTANTS.SIMULATION_TIMESTEP_SEC): void {
    if (!this.isInitialized) return;

    this.tickCount++;

    // Input timeout watchdog: if no packets received for > 200ms, auto-neutralize
    if (Date.now() - this.lastInputTime > 200) {
      this.lastInput.steering = 0;
      this.lastInput.throttle = 0;
      this.lastInput.brake = false;
    }

    const { steering, throttle, brake } = this.lastInput;
    const {
      maxSpeed,
      maxReverseSpeed,
      acceleration,
      brakingPower,
      friction,
      turnSpeed,
    } = CONSTANTS.KART_PHYSICS;

    let { x, y, z, rotation, speed } = this.state;

    // 1. Throttle / Acceleration
    if (throttle > 0 && !brake) {
      speed += acceleration * throttle * dt;
      if (speed > maxSpeed) {
        speed = maxSpeed;
      }
    }

    // 2. Braking / Reverse
    if (brake) {
      if (speed > 0) {
        // Forward braking
        speed -= brakingPower * dt;
        if (speed < 0) speed = 0;
      } else {
        // Reverse acceleration when holding brake from standstill
        speed -= (acceleration * 0.5) * dt;
        if (speed < -maxReverseSpeed) speed = -maxReverseSpeed;
      }
    }

    // 3. Friction & Rolling resistance (when neither accelerating nor braking)
    if (throttle === 0 && !brake) {
      if (speed > 0) {
        speed = Math.max(0, speed - friction * (speed + 1.0) * dt);
      } else if (speed < 0) {
        speed = Math.min(0, speed + friction * (Math.abs(speed) + 1.0) * dt);
      }
    }

    // 4. Steering and Angular Rotation (only turns when car has movement)
    if (Math.abs(steering) > 0.01 && Math.abs(speed) > 0.3) {
      // Car turns proportional to forward speed, preventing standing spinning
      const speedRatio = Math.min(1.0, Math.abs(speed) / 6.0);
      const direction = speed >= 0 ? 1.0 : -1.0;
      rotation += steering * turnSpeed * dt * speedRatio * direction;

      // Wrap rotation within [-PI, PI]
      while (rotation > Math.PI) rotation -= 2 * Math.PI;
      while (rotation < -Math.PI) rotation += 2 * Math.PI;
    }

    // 5. Integrate translation in forward direction
    const dx = Math.sin(rotation) * speed * dt;
    const dz = Math.cos(rotation) * speed * dt;
    let nextX = x + dx;
    let nextZ = z + dz;

    // 6. Track boundary collision resolution
    const { minX, maxX, minZ, maxZ } = CONSTANTS.TRACK_BOUNDS;
    const margin = 1.2; // Kart bounding radius
    let collided = false;

    if (nextX < minX + margin) {
      nextX = minX + margin;
      collided = true;
    } else if (nextX > maxX - margin) {
      nextX = maxX - margin;
      collided = true;
    }

    if (nextZ < minZ + margin) {
      nextZ = minZ + margin;
      collided = true;
    } else if (nextZ > maxZ - margin) {
      nextZ = maxZ - margin;
      collided = true;
    }

    if (collided) {
      // Elastic collision rebound & speed penalty
      speed = -speed * 0.2;
    }

    // 7. Update Rapier Kinematic body & step physics world
    this.kartBody.setNextKinematicTranslation({ x: nextX, y: 0.25, z: nextZ });
    // Rapier rotation from Euler yaw (around Y axis)
    const halfAngle = rotation / 2;
    this.kartBody.setNextKinematicRotation({
      x: 0,
      y: Math.sin(halfAngle),
      z: 0,
      w: Math.cos(halfAngle),
    });

    this.world.step();

    // 8. Commit updated authoritative state
    this.state = {
      x: nextX,
      y: 0.25,
      z: nextZ,
      rotation,
      speed,
    };
  }

  getState(): KartState {
    return { ...this.state };
  }

  getLastAckSequence(): number {
    return this.lastAckSequence;
  }

  getTickCount(): number {
    return this.tickCount;
  }

  resetPosition(): void {
    this.state = {
      x: 0,
      y: 0.25,
      z: 0,
      rotation: 0,
      speed: 0,
    };
    this.clearInput();
    if (this.kartBody) {
      this.kartBody.setTranslation({ x: 0, y: 0.25, z: 0 }, true);
    }
  }
}
