import { Engine } from '@babylonjs/core';
import { io, Socket } from 'socket.io-client';
import { GameStateMessage, ServerDiagnostics } from '../shared/game-types';
import { KartScene } from './scene';
import { TvRenderer, detectRenderBackend } from './renderer';
import { TvDiagnostics } from './diagnostics';
import { WebRtcTvHost } from './webrtc-tv';

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

  const { backend } = detectRenderBackend(engine);
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

  const roomCodeVal = document.getElementById('roomCodeVal') as HTMLElement;

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
      if (info.roomCode && roomCodeVal) {
        roomCodeVal.textContent = info.roomCode;
      }
    }
  } catch (err) {
    console.warn('[TV] Could not fetch server info endpoint:', err);
  }

  // Connect to Server via Socket.IO
  const targetUrl = import.meta.env.DEV && location.port === '5173'
    ? `${location.protocol}//${location.hostname}:3000`
    : undefined;

  const socket: Socket = io(targetUrl as any, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });

  // WebRTC TV Host (direct P2P raw UDP reception)
  const webrtcTv = new WebRtcTvHost(
    socket,
    (directInput) => {
      // Forward direct WebRTC UDP input immediately to server simulation
      socket.emit('input', directInput);
    },
    (status) => {
      if (connPill) {
        connPill.textContent = status.label;
        if (status.p2p) {
          connPill.style.color = '#38bdf8';
          connPill.style.borderColor = '#38bdf8';
          connPill.style.boxShadow = '0 0 16px rgba(56, 189, 248, 0.6)';
        } else {
          connPill.style.color = '#4ade80';
          connPill.style.borderColor = '';
          connPill.style.boxShadow = '';
        }
      }
    }
  );

  socket.on('connect', () => {
    diagnostics.setConnectionStatus('Connected');
    if (connPill) connPill.textContent = '🟢 Server Connected';
    console.log(`[TV] Connected to server (id: ${socket.id})`);
    socket.emit('join', { role: 'tv' });
  });

  // Handle authoritative state updates (60 Hz)
  socket.on('state', (state: GameStateMessage) => {
    renderer.onServerStateUpdate(state.kart);
    diagnostics.recordStateUpdate(state.tick);
  });

  // Handle RTT ping responses
  socket.on('pong', (data: { clientTime: number }) => {
    const rtt = performance.now() - data.clientTime;
    diagnostics.recordRtt(rtt);
  });

  // Handle server health & tick rate diagnostics
  socket.on('server_diagnostics', (diag: ServerDiagnostics) => {
    diagnostics.setServerStats(diag.simulationTickRate, diag.serverProcessingTimeMs);
    diagnostics.setControllerStatus(diag.controllerConnected);

    if (qrModal) {
      qrModal.style.display = diag.controllerConnected ? 'none' : 'flex';
    }
  });

  // Handle client connection updates
  socket.on('status_update', (status: { controllerConnected: boolean }) => {
    diagnostics.setControllerStatus(status.controllerConnected);
    if (qrModal) {
      qrModal.style.display = status.controllerConnected ? 'none' : 'flex';
    }
  });

  socket.on('disconnect', (reason) => {
    console.warn(`[TV] Disconnected (${reason}), reconnecting...`);
    diagnostics.setConnectionStatus('Reconnecting...');
    if (connPill) connPill.textContent = '🔴 Disconnected - Reconnecting...';
  });

  socket.on('connect_error', (err) => {
    console.warn('[TV] Connection error:', err.message);
    diagnostics.setConnectionStatus('Reconnecting...');
    if (connPill) connPill.textContent = '🔴 Connection Error - Retrying...';
  });

  // Periodic Ping for Measured RTT (2 Hz)
  setInterval(() => {
    if (socket.connected) {
      socket.emit('ping', { clientTime: performance.now() });
    }
  }, 500);

  // Independent Render Loop running at device refresh rate (60/120Hz)
  let hardwareSeq = 0;
  let lastGamepadInputTime = 0;

  engine.runRenderLoop(() => {
    const dtSeconds = engine.getDeltaTime() / 1000;
    renderer.render(dtSeconds);

    // Direct Hardware Bluetooth Gamepad Support (0ms network latency)
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i];
        if (gp && gp.connected) {
          // Left Stick X (-1.0 to 1.0) or D-Pad
          let steer = gp.axes[0] || 0;
          if (gp.axes[4] && Math.abs(gp.axes[4]) > Math.abs(steer)) steer = gp.axes[4];

          // Triggers / Buttons (Gas: A/Cross or R2; Brake: B/Circle/Square or L2)
          const gas = (gp.buttons[7]?.pressed || gp.buttons[0]?.pressed || gp.buttons[2]?.pressed || false);
          const brake = (gp.buttons[6]?.pressed || gp.buttons[1]?.pressed || false);

          const now = performance.now();
          if (now - lastGamepadInputTime > 20) { // 50 Hz poll rate
            lastGamepadInputTime = now;
            hardwareSeq++;
            socket.emit('input', {
              type: 'input',
              sequence: hardwareSeq,
              steering: Number(steer.toFixed(2)),
              throttle: gas ? 1.0 : 0.0,
              brake: brake,
              clientTime: now,
            });

            if (connPill) {
              connPill.textContent = `🎮 Bluetooth Gamepad (${gp.id.split('(')[0].trim() || 'Connected'})`;
              connPill.style.color = '#38bdf8';
            }
            if (qrModal && qrModal.style.display !== 'none') {
              qrModal.style.display = 'none';
            }
          }
          break;
        }
      }
    }

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
}

window.addEventListener('DOMContentLoaded', bootstrap);
