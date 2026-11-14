export interface KartState {
  x: number;
  y: number;
  z: number;
  rotation: number; // In radians
  speed: number;    // In m/s
}

export interface ControllerInput {
  type: 'input';
  sequence: number;
  steering: number;  // -1.0 (left) to 1.0 (right)
  throttle: number;  // 0.0 to 1.0
  brake: boolean;
  clientTime?: number;
}

export interface GameStateMessage {
  type: 'state';
  tick: number;
  serverTime: number;
  lastAckSequence: number;
  kart: KartState;
}

export interface PingMessage {
  type: 'ping';
  clientTime: number;
}

export interface PongMessage {
  type: 'pong';
  clientTime: number;
  serverTime: number;
}

export interface ServerDiagnostics {
  activeConnections: number;
  tvConnected: boolean;
  controllerConnected: boolean;
  simulationTickRate: number;
  incomingInputRate: number;
  outgoingStateRate: number;
  serverProcessingTimeMs: number;
  totalTicks: number;
}

export interface ClientDiagnostics {
  fps: number;
  backend: string;
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  lastReceivedTick: number;
  stateUpdateIntervalMs: number;
  rttMs: number;
  estimatedLatencyMs: number;
  lastAckSequence?: number;
  inputRateHz?: number;
}
