import { Engine } from '@babylonjs/core';
import * as Colyseus from '@colyseus/sdk';
import { CONSTANTS } from '../shared/protocol';
import { GameStateMessage, ServerDiagnostics } from '../shared/game-types';
import { KartScene } from './scene';
import { TvRenderer, detectRenderBackend } from './renderer';
import { TvDiagnostics } from './diagnostics';

async function bootstrap() {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
  const diagContainer = document.getElementById('diagOverlay') as HTMLElement;
  const speedDisplay = document.getElementById('speedGauge') as HTMLElement;
  const qrModal = document.getElementById('qrModal') as HTMLElement;
  const qrImage = document.getElementById('qrImage') as HTMLImageElement;
  const qrUrlText = document.getElementById('qrUrlText') as HTMLElement;
  const connPill = document.getElementById('connPill') as HTMLElement;
  const fsBtn = document.getElementById('fsBtn') as HTMLButtonElement;

  // Initialize Babylon.js Engine (Baseline WebGL2)
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: false,
    powerPreference: 'high-performance',
    antialias: true,
  });

  const { backend, isWebGPUAvailable } = detectRenderBackend(engine);
  console.log(`[TV] Engine initialized with backend: ${backend}`);

  // Create Scene & Renderer
  const kartScene = new KartScene(engine, canvas);
  const renderer = new TvRenderer(kartScene, engine);
  const diagnostics = new TvDiagnostics(engine, backend);

  // Fullscreen support for Android TV
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  // Fetch LAN controller QR code & info from server API
  try {
    const infoRes = await fetch('/api/info');
    if (infoRes.ok) {
      const info = await infoRes.json();
      if (info.qrDataUrl && qrImage) {
        qrImage.src = info.qrDataUrl;
      }
      if (info.controllerUrl && qrUrlText) {
        qrUrlText.textContent = info.controllerUrl;
      }
    }
  } catch (err) {
    console.warn('[TV] Could not fetch server info endpoint:', err);
  }

  // Connect to Colyseus Server
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serverEndpoint = `${wsProtocol}//${location.host}`;
  const client = new Colyseus.Client(serverEndpoint);

  let room: Colyseus.Room | null = null;

  async function connectToRoom() {
    diagnostics.setConnectionStatus('Connecting...');
    if (connPill) connPill.textContent = '🟡 Connecting to Server...';

    try {
      room = await client.joinOrCreate(CONSTANTS.ROOM_NAME, { role: 'tv' });
      diagnostics.setConnectionStatus('Connected');
      if (connPill) connPill.textContent = '🟢 Server Connected';
      console.log(`[TV] Joined room "${room.id}" with session ${room.sessionId}`);

      // Handle authoritative state updates
      room.onMessage('state', (state: GameStateMessage) => {
        renderer.onServerStateUpdate(state.kart);
        diagnostics.recordStateUpdate(state.tick);
      });

      // Handle RTT ping responses
      room.onMessage('pong', (data: { clientTime: number }) => {
        const rtt = performance.now() - data.clientTime;
        diagnostics.recordRtt(rtt);
      });

      // Handle server health & tick rate diagnostics
      room.onMessage('server_diagnostics', (diag: ServerDiagnostics) => {
        diagnostics.setServerStats(diag.simulationTickRate, diag.serverProcessingTimeMs);
        diagnostics.setControllerStatus(diag.controllerConnected);

        if (qrModal) {
          qrModal.style.display = diag.controllerConnected ? 'none' : 'flex';
        }
      });

      // Handle client connection updates
      room.onMessage('status_update', (status: { controllerConnected: boolean }) => {
        diagnostics.setControllerStatus(status.controllerConnected);
        if (qrModal) {
          qrModal.style.display = status.controllerConnected ? 'none' : 'flex';
        }
      });

      // Room disconnect handler
      room.onLeave((code) => {
        console.warn(`[TV] Left room (code ${code}), attempting reconnect in 2s...`);
        diagnostics.setConnectionStatus('Reconnecting...');
        if (connPill) connPill.textContent = '🔴 Disconnected - Reconnecting...';
        setTimeout(connectToRoom, 2000);
      });

      room.onError((errCode, errMsg) => {
        console.error(`[TV] Room error [${errCode}]:`, errMsg);
      });
    } catch (err) {
      console.error('[TV] Room connection failed, retrying in 2s:', err);
      diagnostics.setConnectionStatus('Reconnecting...');
      if (connPill) connPill.textContent = '🔴 Connection Failed - Retrying...';
      setTimeout(connectToRoom, 2000);
    }
  }

  // Periodic Ping for Measured RTT
  setInterval(() => {
    if (room && room.connection && room.connection.isOpen) {
      room.send('ping', { clientTime: performance.now() });
    }
  }, 500);

  // Independent Render Loop running at device refresh rate (60/120Hz)
  engine.runRenderLoop(() => {
    const dtSeconds = engine.getDeltaTime() / 1000;
    renderer.render(dtSeconds);

    // Update speedometer (m/s to km/h)
    const speed = renderer.getCurrentSpeed();
    const speedKmh = Math.abs(Math.round(speed * 3.6));
    if (speedDisplay) {
      speedDisplay.textContent = `${speedKmh} km/h`;
    }

    // Update Diagnostics Overlay
    if (diagContainer) {
      diagnostics.updateDom(diagContainer, speedKmh);
    }
  });

  // Handle window resizing
  window.addEventListener('resize', () => {
    engine.resize();
  });

  // Start initial connection
  connectToRoom();
}

window.addEventListener('DOMContentLoaded', bootstrap);
