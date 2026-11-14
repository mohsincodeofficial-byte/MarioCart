import { Engine } from '@babylonjs/core';

export interface TvDiagnosticsData {
  fps: number;
  backend: string;
  connectionStatus: string;
  lastReceivedTick: number;
  stateUpdateIntervalMs: number;
  measuredRttMs: number;
  estimatedLatencyMs: number;
  serverTickRate?: number;
  serverCpuMs?: number;
  controllerConnected?: boolean;
}

export class TvDiagnostics {
  private lastStateTimestamp = 0;
  private stateIntervalSamples: number[] = [];
  private avgStateIntervalMs = 0;
  private measuredRttMs = 0;
  private lastTick = 0;
  private connectionStatus = 'Connecting...';
  private controllerConnected = false;
  private serverTickRate = 60;
  private serverCpuMs = 0;

  constructor(private engine: Engine, private backendString: string) {}

  public recordStateUpdate(tick: number): void {
    const now = performance.now();
    if (this.lastStateTimestamp > 0) {
      const delta = now - this.lastStateTimestamp;
      this.stateIntervalSamples.push(delta);
      if (this.stateIntervalSamples.length > 20) {
        this.stateIntervalSamples.shift();
      }
      this.avgStateIntervalMs =
        this.stateIntervalSamples.reduce((a, b) => a + b, 0) / this.stateIntervalSamples.length;
    }
    this.lastStateTimestamp = now;
    this.lastTick = tick;
  }

  public recordRtt(rttMs: number): void {
    this.measuredRttMs = rttMs;
  }

  public setConnectionStatus(status: string): void {
    this.connectionStatus = status;
  }

  public setControllerStatus(connected: boolean): void {
    this.controllerConnected = connected;
  }

  public setServerStats(tickRate: number, cpuMs: number): void {
    this.serverTickRate = tickRate;
    this.serverCpuMs = cpuMs;
  }

  public getData(): TvDiagnosticsData {
    return {
      fps: Math.round(this.engine.getFps()),
      backend: this.backendString,
      connectionStatus: this.connectionStatus,
      lastReceivedTick: this.lastTick,
      stateUpdateIntervalMs: Number(this.avgStateIntervalMs.toFixed(1)),
      measuredRttMs: Number(this.measuredRttMs.toFixed(1)),
      estimatedLatencyMs: Number((this.measuredRttMs / 2).toFixed(1)),
      serverTickRate: this.serverTickRate,
      serverCpuMs: this.serverCpuMs,
      controllerConnected: this.controllerConnected,
    };
  }

  public updateDom(container: HTMLElement, speedKmh: number): void {
    const data = this.getData();

    const connColor =
      data.connectionStatus === 'Connected'
        ? '#4ade80'
        : data.connectionStatus === 'Reconnecting...'
        ? '#facc15'
        : '#ef4444';

    const phoneColor = data.controllerConnected ? '#4ade80' : '#facc15';

    container.innerHTML = `
      <div class="diag-card">
        <div class="diag-header">TV DIAGNOSTICS & METRICS</div>
        <div class="diag-grid">
          <div class="diag-item">
            <span class="label">Rendering FPS:</span>
            <span class="val ${data.fps >= 55 ? 'good' : 'warn'}">${data.fps} FPS</span>
          </div>
          <div class="diag-item">
            <span class="label">Graphics Backend:</span>
            <span class="val highlight">${data.backend}</span>
          </div>
          <div class="diag-item">
            <span class="label">Server Connection:</span>
            <span class="val" style="color: ${connColor}">${data.connectionStatus}</span>
          </div>
          <div class="diag-item">
            <span class="label">Mobile Controller:</span>
            <span class="val" style="color: ${phoneColor}">
              ${data.controllerConnected ? '🟢 Connected' : '🟡 Waiting for Phone...'}
            </span>
          </div>
          <div class="diag-item">
            <span class="label">Last State Tick:</span>
            <span class="val">#${data.lastReceivedTick}</span>
          </div>
          <div class="diag-item">
            <span class="label">State Interval:</span>
            <span class="val">${data.stateUpdateIntervalMs} ms (~${data.stateUpdateIntervalMs > 0 ? Math.round(1000 / data.stateUpdateIntervalMs) : 0} Hz)</span>
          </div>
          <div class="diag-item">
            <span class="label">Measured RTT:</span>
            <span class="val ${data.measuredRttMs < 50 ? 'good' : 'warn'}">${data.measuredRttMs} ms</span>
          </div>
          <div class="diag-item">
            <span class="label">Est. 1-Way Latency:</span>
            <span class="val">${data.estimatedLatencyMs} ms</span>
          </div>
          <div class="diag-item">
            <span class="label">Server Sim Rate:</span>
            <span class="val">${data.serverTickRate} Hz (${data.serverCpuMs}ms CPU)</span>
          </div>
        </div>
      </div>
    `;
  }
}
