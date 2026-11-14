import { Engine, Vector3 } from '@babylonjs/core';
import { KartScene } from './scene';
import { KartState } from '../shared/game-types';

export class TvRenderer {
  // Current interpolated visual transform
  private currentX = 0;
  private currentY = 0.25;
  private currentZ = 0;
  private currentRotation = 0;
  private currentSpeed = 0;

  // Target authoritative transform received from server
  private targetX = 0;
  private targetY = 0.25;
  private targetZ = 0;
  private targetRotation = 0;
  private targetSpeed = 0;

  private isFirstState = true;
  private smoothingLambda = 22.0; // Responsive exponential smoothing constant

  constructor(public kartScene: KartScene, public engine: Engine) {}

  public onServerStateUpdate(state: KartState): void {
    this.targetX = state.x;
    this.targetY = state.y;
    this.targetZ = state.z;
    this.targetRotation = state.rotation;
    this.targetSpeed = state.speed;

    // Snap directly on initial state arrival to avoid flying in from origin
    if (this.isFirstState) {
      this.currentX = this.targetX;
      this.currentY = this.targetY;
      this.currentZ = this.targetZ;
      this.currentRotation = this.targetRotation;
      this.currentSpeed = this.targetSpeed;
      this.isFirstState = false;
    }
  }

  public render(dtSeconds: number): void {
    if (!this.isFirstState) {
      // Frame-rate independent exponential interpolation
      const alpha = 1.0 - Math.exp(-this.smoothingLambda * Math.min(dtSeconds, 0.1));

      // 1. Position Lerp
      this.currentX += (this.targetX - this.currentX) * alpha;
      this.currentY += (this.targetY - this.currentY) * alpha;
      this.currentZ += (this.targetZ - this.currentZ) * alpha;

      // 2. Shortest-path Angle Lerp
      let diff = this.targetRotation - this.currentRotation;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      this.currentRotation += diff * alpha;

      // 3. Speed Lerp
      this.currentSpeed += (this.targetSpeed - this.currentSpeed) * alpha;

      // Apply to Babylon Scene meshes
      this.kartScene.applyTransform(
        this.currentX,
        this.currentY,
        this.currentZ,
        this.currentRotation,
        this.currentSpeed
      );
    }

    this.kartScene.scene.render();
  }

  public getCurrentSpeed(): number {
    return this.currentSpeed;
  }
}

export function detectRenderBackend(engine: Engine): { backend: string; isWebGPUAvailable: boolean } {
  const isWebGPUAvailable = 'gpu' in navigator;
  const gl = (engine as any)._gl;
  const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

  let backendName = isWebGL2 ? 'WebGL2 (Standard)' : 'WebGL1';
  if (isWebGPUAvailable) {
    backendName += ' [WebGPU Ready]';
  }

  return {
    backend: backendName,
    isWebGPUAvailable,
  };
}
