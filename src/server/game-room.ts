import { Room, Client } from 'colyseus';
import { GameRoomStateSchema, CONSTANTS, validateControllerInput } from '../shared/protocol';
import { KartSimulation } from './simulation';
import { ControllerInput, GameStateMessage, ServerDiagnostics } from '../shared/game-types';

export class GameRoom extends Room<GameRoomStateSchema> {
  maxClients = 10; // TV + Phone + optional local inspector
  private simulation = new KartSimulation();

  private controllerClient: Client | null = null;
  private tvClients = new Set<Client>();

  // Diagnostic counters
  private tickCounter = 0;
  private inputCounter = 0;
  private stateBroadcastCounter = 0;
  private totalProcessingTime = 0;

  private currentInputRate = 0;
  private currentTickRate = 0;
  private currentStateRate = 0;
  private currentAvgProcessingTimeMs = 0;

  private statsInterval!: NodeJS.Timeout;

  async onCreate(options: any) {
    this.setState(new GameRoomStateSchema());

    // Initialize Rapier physics
    await this.simulation.init();

    // Set schema patch rate to 60Hz (approx 16.6ms)
    this.setPatchRate(1000 / CONSTANTS.SIMULATION_RATE_HZ);

    // Run fixed 60Hz authoritative simulation loop
    this.setSimulationInterval((deltaTime) => {
      this.update(deltaTime / 1000);
    }, 1000 / CONSTANTS.SIMULATION_RATE_HZ);

    // Register controller input message handler
    this.onMessage('input', (client, rawData) => {
      // Only accept input from the active controller
      if (this.controllerClient && client.sessionId !== this.controllerClient.sessionId) {
        return;
      }

      const input = validateControllerInput(rawData);
      if (input) {
        this.inputCounter++;
        this.simulation.applyInput(input);

        // Immediate sequence acknowledgment echo to controller
        client.send('ack', {
          sequence: input.sequence,
          clientTime: input.clientTime,
          serverTime: Date.now(),
        });
      }
    });

    // Register ping handler for high-precision RTT measurement
    this.onMessage('ping', (client, data: { clientTime: number }) => {
      client.send('pong', {
        clientTime: data?.clientTime || 0,
        serverTime: Date.now(),
      });
    });

    // Reset kart position command (useful for testing)
    this.onMessage('reset', () => {
      this.simulation.resetPosition();
      console.log('[GameRoom] Kart position reset requested.');
    });

    // Diagnostics 1-second rolling window calculator
    this.statsInterval = setInterval(() => {
      this.currentTickRate = this.tickCounter;
      this.currentInputRate = this.inputCounter;
      this.currentStateRate = this.stateBroadcastCounter;
      this.currentAvgProcessingTimeMs =
        this.tickCounter > 0 ? this.totalProcessingTime / this.tickCounter : 0;

      // Broadcast diagnostics to all connected peers
      this.broadcast('server_diagnostics', this.getDiagnostics());

      // Reset interval counters
      this.tickCounter = 0;
      this.inputCounter = 0;
      this.stateBroadcastCounter = 0;
      this.totalProcessingTime = 0;
    }, 1000);

    console.log(`[GameRoom] Room "${this.roomId}" created at 60Hz fixed simulation rate.`);
  }

  onJoin(client: Client, options: { role?: 'tv' | 'controller' }) {
    const role = options?.role || 'tv';

    if (role === 'controller') {
      if (this.controllerClient) {
        console.log(`[GameRoom] Replacing existing controller with new session ${client.sessionId}`);
      }
      this.controllerClient = client;
      this.state.controllerConnected = true;
      console.log(`[GameRoom] Controller connected: ${client.sessionId}`);
    } else {
      this.tvClients.add(client);
      this.state.tvConnected = true;
      console.log(`[GameRoom] TV / Display client connected: ${client.sessionId}`);
    }

    // Broadcast current client role assignment
    client.send('assigned_role', { role });
    this.broadcastConnectionStatus();
  }

  onLeave(client: Client, consented?: boolean) {
    if (this.controllerClient && client.sessionId === this.controllerClient.sessionId) {
      console.log(`[GameRoom] Controller disconnected (${consented ? 'consented' : 'abrupt'})`);
      this.controllerClient = null;
      this.state.controllerConnected = false;
      // Stop moving kart when controller drops
      this.simulation.clearInput();
    }

    if (this.tvClients.has(client)) {
      this.tvClients.delete(client);
      this.state.tvConnected = this.tvClients.size > 0;
      console.log(`[GameRoom] TV client left: ${client.sessionId}`);
    }

    this.broadcastConnectionStatus();
  }

  onDispose() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    console.log(`[GameRoom] Room "${this.roomId}" disposed.`);
  }

  private update(dt: number) {
    const start = performance.now();

    // 1. Advance authoritative simulation
    this.simulation.step(dt);
    this.tickCounter++;

    const kartState = this.simulation.getState();
    const lastAckSequence = this.simulation.getLastAckSequence();
    const tick = this.simulation.getTickCount();
    const serverTime = Date.now();

    // 2. Synchronize Colyseus Schema
    this.state.tick = tick;
    this.state.serverTime = serverTime;
    this.state.lastAckSequence = lastAckSequence;
    this.state.kart.copyFrom(kartState);

    // 3. High-frequency state broadcast message
    const statePayload: GameStateMessage = {
      type: 'state',
      tick,
      serverTime,
      lastAckSequence,
      kart: kartState,
    };

    this.broadcast('state', statePayload);
    this.stateBroadcastCounter++;

    const elapsed = performance.now() - start;
    this.totalProcessingTime += elapsed;
  }

  private broadcastConnectionStatus() {
    this.broadcast('status_update', {
      controllerConnected: !!this.controllerClient,
      tvConnected: this.tvClients.size > 0,
      activeClients: this.clients.length,
    });
  }

  getDiagnostics(): ServerDiagnostics {
    return {
      activeConnections: this.clients.length,
      tvConnected: this.tvClients.size > 0,
      controllerConnected: !!this.controllerClient,
      simulationTickRate: this.currentTickRate,
      incomingInputRate: this.currentInputRate,
      outgoingStateRate: this.currentStateRate,
      serverProcessingTimeMs: Number(this.currentAvgProcessingTimeMs.toFixed(3)),
      totalTicks: this.simulation.getTickCount(),
    };
  }
}
