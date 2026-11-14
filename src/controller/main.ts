import * as Colyseus from '@colyseus/sdk';
import { CONSTANTS } from '../shared/protocol';
import { InputManager } from './input';
import { VirtualController } from './controller';

async function bootstrap() {
  const connStatusEl = document.getElementById('connStatus') as HTMLElement;
  const rttEl = document.getElementById('rttVal') as HTMLElement;
  const rateEl = document.getElementById('rateVal') as HTMLElement;
  const seqEl = document.getElementById('seqVal') as HTMLElement;
  const motionBtn = document.getElementById('btnMotionToggle') as HTMLButtonElement;
  const motionStatusEl = document.getElementById('motionStatus') as HTMLElement;
  const resetBtn = document.getElementById('btnReset') as HTMLButtonElement;
  const steerVisualEl = document.getElementById('steerVisual') as HTMLElement;

  let measuredRtt = 0;
  let connectionState = 'Connecting...';

  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serverEndpoint = `${wsProtocol}//${location.host}`;
  const client = new Colyseus.Client(serverEndpoint);
  let room: Colyseus.Room | null = null;

  // Initialize Input Manager
  const inputManager = new InputManager((input) => {
    if (room && room.connection && room.connection.isOpen) {
      room.send('input', input);
    }
  });
  inputManager.start();

  // Initialize Virtual Controller (Touch & Sensor handlers)
  const virtualController = new VirtualController(inputManager);

  // Setup Motion Sensor Toggle
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
      motionStatusEl.style.color = enabled ? '#38bdf8' : '#8b949e';
    }
  }

  // Setup Reset Kart Button
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (room && room.connection && room.connection.isOpen) {
        room.send('reset', {});
      }
    });
  }

  // Room Connection & Reconnect Handling
  async function connect() {
    connectionState = 'Connecting...';
    updateConnectionUi();

    try {
      room = await client.joinOrCreate(CONSTANTS.ROOM_NAME, { role: 'controller' });
      connectionState = 'Connected';
      updateConnectionUi();
      console.log(`[Controller] Connected with sessionId: ${room.sessionId}`);

      // Handle sequence acknowledgment from server
      room.onMessage('ack', (ack: { sequence: number; clientTime?: number }) => {
        inputManager.onAck(ack.sequence);
      });

      // Handle ping responses for high-accuracy RTT measurement
      room.onMessage('pong', (pong: { clientTime: number }) => {
        measuredRtt = performance.now() - pong.clientTime;
      });

      room.onLeave((code) => {
        console.warn(`[Controller] Left room (${code}), reconnecting in 2s...`);
        connectionState = 'Reconnecting...';
        updateConnectionUi();
        setTimeout(connect, 2000);
      });

      room.onError((errCode, errMsg) => {
        console.error(`[Controller] Room error [${errCode}]:`, errMsg);
      });
    } catch (err) {
      console.error('[Controller] Connection failed, retrying in 2s:', err);
      connectionState = 'Reconnecting...';
      updateConnectionUi();
      setTimeout(connect, 2000);
    }
  }

  function updateConnectionUi() {
    if (!connStatusEl) return;
    connStatusEl.textContent = connectionState;

    if (connectionState === 'Connected') {
      connStatusEl.style.color = '#4ade80';
    } else if (connectionState === 'Reconnecting...') {
      connStatusEl.style.color = '#facc15';
    } else {
      connStatusEl.style.color = '#ef4444';
    }
  }

  // Periodic RTT Ping
  setInterval(() => {
    if (room && room.connection && room.connection.isOpen) {
      room.send('ping', { clientTime: performance.now() });
    }
  }, 500);

  // Diagnostics DOM Update Loop (10 updates per sec)
  setInterval(() => {
    const diag = inputManager.getDiagnostics();

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

    // Visual Steering Bar Indicator
    if (steerVisualEl) {
      const percentage = (diag.steering + 1) * 50; // Map -1..1 to 0..100%
      steerVisualEl.style.left = `${percentage}%`;
    }
  }, 100);

  connect();
}

window.addEventListener('DOMContentLoaded', bootstrap);
