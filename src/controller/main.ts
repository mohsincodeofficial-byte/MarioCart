import { io, Socket } from 'socket.io-client';
import { InputManager } from './input';
import { VirtualController } from './controller';
import { GameStateMessage } from '../shared/game-types';
import { WebRtcControllerClient } from './webrtc-controller';

async function bootstrap() {
  const connStatusEl = document.getElementById('connStatus') as HTMLElement;
  const statusDotEl = document.getElementById('statusDot') as HTMLElement;
  const rttEl = document.getElementById('rttVal') as HTMLElement;
  const rateEl = document.getElementById('rateVal') as HTMLElement;
  const seqEl = document.getElementById('seqVal') as HTMLElement;
  const motionBtn = document.getElementById('btnMotionToggle') as HTMLButtonElement;
  const motionStatusEl = document.getElementById('motionStatus') as HTMLElement;
  const resetBtn = document.getElementById('btnReset') as HTMLButtonElement;
  const steerVisualEl = document.getElementById('steerVisual') as HTMLElement;
  const speedDisplayEl = document.getElementById('speedDisplay') as HTMLElement;

  let measuredRtt = 0;
  let connectionState = 'Connecting...';

  // In dev mode (Vite on 5173), target port 3000. In prod, connect to origin.
  const targetUrl = import.meta.env.DEV && location.port === '5173'
    ? `${location.protocol}//${location.hostname}:3000`
    : undefined;

  // Socket.IO auto-reconnects and falls back to HTTP polling if WebSocket is blocked!
  const socket: Socket = io(targetUrl as any, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });

  // Initialize Input Manager (streams inputs ~40Hz)
  const inputManager = new InputManager((input) => {
    if (socket.connected) {
      socket.emit('input', input);
    }
  });
  inputManager.start();

  // Initialize Virtual Controller (Touch, DualSense Analog Stick, Triggers & Gyro)
  const virtualController = new VirtualController(inputManager);

  // WebRTC P2P DataChannel Client with Persistent Pairing
  const webrtcClient = new WebRtcControllerClient(
    socket,
    inputManager,
    (status) => {
      if (connStatusEl) {
        connStatusEl.textContent = status.label;
        if (status.p2p) {
          connStatusEl.style.color = '#38bdf8';
          if (statusDotEl) {
            statusDotEl.classList.add('connected');
            statusDotEl.style.background = '#38bdf8';
            statusDotEl.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.8)';
          }
        } else if (status.paired) {
          connStatusEl.style.color = '#4ade80';
          if (statusDotEl) {
            statusDotEl.classList.add('connected');
            statusDotEl.style.background = '';
            statusDotEl.style.boxShadow = '';
          }
        } else {
          connStatusEl.style.color = '#facc15';
        }
      }
    }
  );

  // Wire PS Button & Triangle Reset
  const emitReset = () => {
    if (socket.connected) {
      socket.emit('reset', {});
      virtualController.triggerHaptic([20, 50, 20]);
    }
  };

  virtualController.setOnReset(emitReset);
  if (resetBtn) {
    resetBtn.addEventListener('click', emitReset);
  }

  // Setup Motion Sensor Toggle (Create button)
  if (motionBtn) {
    motionBtn.addEventListener('click', async () => {
      const enabled = await virtualController.toggleMotionMode();
      motionBtn.classList.toggle('active', enabled);
      updateMotionUi();
    });
  }

  function updateMotionUi() {
    const { enabled, statusText } = virtualController.getMotionStatus();
    if (motionStatusEl) {
      motionStatusEl.textContent = statusText;
      motionStatusEl.style.color = enabled ? '#38bdf8' : '#94a3b8';
    }
  }

  function updateConnectionUi() {
    if (connStatusEl) {
      connStatusEl.textContent = connectionState;
      if (connectionState === 'Connected') {
        connStatusEl.style.color = '#4ade80';
      } else if (connectionState === 'Reconnecting...') {
        connStatusEl.style.color = '#facc15';
      } else {
        connStatusEl.style.color = '#ef4444';
      }
    }

    if (statusDotEl) {
      if (connectionState === 'Connected') {
        statusDotEl.classList.add('connected');
      } else {
        statusDotEl.classList.remove('connected');
      }
    }
  }

  // Socket.IO Event Handlers
  socket.on('connect', () => {
    connectionState = 'Connected';
    updateConnectionUi();
    console.log(`[DualSense Controller] Connected to signaling (id: ${socket.id})`);
    webrtcClient.startPairing();
  });

  socket.on('ack', (ack: { sequence: number; clientTime?: number }) => {
    inputManager.onAck(ack.sequence);
  });

  socket.on('pong', (pong: { clientTime: number }) => {
    measuredRtt = performance.now() - pong.clientTime;
  });

  // Receive telemetry to display live speed on the touchpad
  socket.on('state', (state: GameStateMessage) => {
    if (speedDisplayEl && state.kart) {
      const speedKmh = Math.round((state.kart.speed || 0) * 3.6);
      speedDisplayEl.textContent = `${speedKmh} KM/H`;
    }
  });

  socket.on('disconnect', (reason) => {
    console.warn(`[DualSense Controller] Disconnected: ${reason}`);
    connectionState = 'Reconnecting...';
    updateConnectionUi();
  });

  socket.on('connect_error', (err) => {
    console.warn('[DualSense Controller] Connection error:', err.message);
    connectionState = 'Reconnecting...';
    updateConnectionUi();
  });

  // Periodic RTT Ping (2 Hz)
  setInterval(() => {
    if (socket.connected) {
      socket.emit('ping', { clientTime: performance.now() });
    }
  }, 500);

  // Diagnostics DOM Update Loop (10 updates per sec)
  const netTypeEl = document.getElementById('netTypeVal') as HTMLElement;

  setInterval(() => {
    const diag = inputManager.getDiagnostics();

    if (netTypeEl) {
      const isP2p = inputManager.getIsP2pActive();
      netTypeEl.textContent = isP2p ? '⚡ P2P UDP' : 'Relay (TCP)';
      netTypeEl.style.color = isP2p ? '#38bdf8' : '#4ade80';
    }

    if (rttEl) {
      rttEl.textContent = `${Math.round(measuredRtt)} ms`;
      rttEl.style.color = measuredRtt < 50 ? '#4ade80' : '#facc15';
    }

    if (rateEl) {
      rateEl.textContent = `${diag.sendRateHz} Hz`;
    }

    if (seqEl) {
      seqEl.textContent = `#${diag.lastAckSequence} / #${diag.currentSequence}`;
    }

    // Visual Steering Bar Indicator on Touchpad
    if (steerVisualEl) {
      const percentage = (diag.steering + 1) * 50; // Map -1..1 to 0..100%
      steerVisualEl.style.left = `${percentage}%`;
    }
  }, 100);
}

window.addEventListener('DOMContentLoaded', bootstrap);
