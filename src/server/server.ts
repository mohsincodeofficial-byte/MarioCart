import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { CONSTANTS, validateControllerInput } from '../shared/protocol';
import { KartSimulation } from './simulation';
import { GameStateMessage, ServerDiagnostics } from '../shared/game-types';
import { DeviceRegistry } from './device-registry';
import { PairingRequest, WebRtcSignalMessage, DEFAULT_ROOM_CODE } from '../shared/webrtc-protocol';

// Prevent socket resets from killing the game server
process.on('uncaughtException', (err: any) => {
  if (err && (err.code === 'ECONNRESET' || err.code === 'EPIPE')) {
    return; // Normal mobile disconnects, ignore safely
  }
  console.error('[Server UncaughtException]', err);
});

export function getLanIpv4(): string {
  const ifaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (/wi-?fi|wlan|eth|ethernet/i.test(name)) {
          return iface.address;
        }
        candidates.push(iface.address);
      }
    }
  }

  return candidates.length > 0 ? candidates[0] : '127.0.0.1';
}

export async function startServer(port = Number(process.env.PORT) || CONSTANTS.DEFAULT_PORT) {
  const lanIp = getLanIpv4();
  const deviceRegistry = new DeviceRegistry();
  const sessionToken = deviceRegistry.getSessionPairToken();
  const roomCode = DEFAULT_ROOM_CODE;

  // The pairing URL encodes the room and one-time session approval token
  const controllerUrl = `http://${lanIp}:${port}/controller?room=${roomCode}&token=${sessionToken}`;
  const tvUrl = `http://${lanIp}:${port}/tv`;
  const hubUrl = `http://${lanIp}:${port}`;

  // Pre-generate QR Code as DataURL with pairing parameters
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(controllerUrl, {
      width: 280,
      margin: 1.5,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  } catch (err) {
    console.error('Failed to generate QR data URL:', err);
  }

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Discovery info endpoint
  app.get('/api/info', (_req, res) => {
    res.json({
      lanIp,
      port,
      hubUrl,
      tvUrl,
      controllerUrl,
      qrDataUrl,
      roomCode,
      sessionToken,
      pairedDevices: deviceRegistry.list(),
    });
  });

  const distPath = path.resolve(process.cwd(), 'dist/client');
  const hasDist = fs.existsSync(distPath);

  app.get('/manifest.json', (_req, res) => res.sendFile(path.resolve(process.cwd(), 'manifest.json')));

  if (hasDist && process.env.NODE_ENV !== 'development') {
    console.log(`[HTTP] Serving pre-built client from: ${distPath}`);
    app.use(express.static(distPath));
    app.get('/tv', (_req, res) => res.sendFile(path.join(distPath, 'tv.html')));
    app.get('/controller', (_req, res) => res.sendFile(path.join(distPath, 'controller.html')));
    app.get('/', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  } else {
    app.get('/tv', (_req, res) => res.sendFile(path.resolve(process.cwd(), 'tv.html')));
    app.get('/controller', (_req, res) => res.sendFile(path.resolve(process.cwd(), 'controller.html')));
    app.get('/', (_req, res) => res.sendFile(path.resolve(process.cwd(), 'index.html')));
  }

  const server = http.createServer(app);

  // Setup Socket.IO with WebSocket + polling fallback for 100% reliable connections
  const io = new SocketIOServer(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
  });

  // Authoritative Physics Simulation
  const simulation = new KartSimulation();
  await simulation.init();

  let controllerSocket: Socket | null = null;
  const tvSockets = new Set<Socket>();

  let tickCounter = 0;
  let inputCounter = 0;
  let stateBroadcastCounter = 0;
  let totalProcessingTime = 0;

  let currentTickRate = 0;
  let currentInputRate = 0;
  let currentStateRate = 0;
  let currentAvgProcessingTimeMs = 0;

  function broadcastStatus() {
    io.emit('status_update', {
      controllerConnected: !!controllerSocket,
      tvConnected: tvSockets.size > 0,
      activeClients: io.engine.clientsCount,
    });
  }

  function getDiagnostics(): ServerDiagnostics {
    return {
      activeConnections: io.engine.clientsCount,
      tvConnected: tvSockets.size > 0,
      controllerConnected: !!controllerSocket,
      simulationTickRate: currentTickRate,
      incomingInputRate: currentInputRate,
      outgoingStateRate: currentStateRate,
      serverProcessingTimeMs: Number(currentAvgProcessingTimeMs.toFixed(3)),
      totalTicks: simulation.getTickCount(),
    };
  }

  // Socket.IO Connection Handler
  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Peer connected: ${socket.id}`);

    // Pair Controller (Persistent identity + auto-approval check)
    socket.on('pair_controller', (data: PairingRequest) => {
      const { deviceId, deviceName, token } = data;
      const isKnown = deviceRegistry.isAuthorized(deviceId, token);
      const isSessionTokenValid = deviceRegistry.isValidSessionToken(token);

      console.log(`[Pairing] Request from "${deviceName}" (${deviceId}) - Known: ${isKnown}, TokenValid: ${isSessionTokenValid}`);

      if (isKnown || isSessionTokenValid) {
        // Auto-approve device and save in persistent registry
        const record = deviceRegistry.registerAndApprove(deviceId, deviceName, token);
        socket.data.role = 'controller';
        socket.data.deviceId = deviceId;
        controllerSocket = socket;

        socket.emit('pair_status', {
          status: 'approved',
          deviceId: record.deviceId,
          token: record.token,
          name: record.name,
        });

        // Notify TV clients of active paired controller
        tvSockets.forEach((tv) => {
          tv.emit('controller_paired', {
            deviceId: record.deviceId,
            name: record.name,
            socketId: socket.id,
          });
        });

        broadcastStatus();
      } else {
        // Unknown device -> ask TV for approval
        socket.data.deviceId = deviceId;
        socket.emit('pair_status', {
          status: 'pending',
          deviceId,
          name: deviceName,
        });

        tvSockets.forEach((tv) => {
          tv.emit('device_pairing_request', {
            deviceId,
            name: deviceName,
            socketId: socket.id,
          });
        });
      }
    });

    // Host/TV approves a pending device
    socket.on('approve_device', (data: { deviceId: string; name?: string }) => {
      const record = deviceRegistry.registerAndApprove(data.deviceId, data.name || 'Wireless Controller');
      io.sockets.sockets.forEach((s) => {
        if (s.data.deviceId === data.deviceId) {
          s.data.role = 'controller';
          controllerSocket = s;
          s.emit('pair_status', {
            status: 'approved',
            deviceId: record.deviceId,
            token: record.token,
            name: record.name,
          });
        }
      });
      broadcastStatus();
    });

    // WebRTC Signaling Relay between TV & Controller
    socket.on('webrtc_signal', (msg: WebRtcSignalMessage) => {
      if (msg.target === 'tv') {
        tvSockets.forEach((tv) => {
          tv.emit('webrtc_signal', {
            senderId: socket.id,
            type: msg.type,
            payload: msg.payload,
          });
        });
      } else if (msg.target === 'controller') {
        if (controllerSocket) {
          controllerSocket.emit('webrtc_signal', {
            senderId: socket.id,
            type: msg.type,
            payload: msg.payload,
          });
        }
      }
    });

    socket.on('join', (data: { role?: 'tv' | 'controller'; deviceId?: string }) => {
      const role = data?.role || 'tv';
      socket.data.role = role;

      if (role === 'controller') {
        controllerSocket = socket;
        console.log(`[Socket.IO] Controller registered: ${socket.id}`);
      } else {
        tvSockets.add(socket);
        console.log(`[Socket.IO] TV / Display registered: ${socket.id}`);
      }

      socket.emit('assigned_role', { role });
      broadcastStatus();
    });

    socket.on('input', (rawData) => {
      const input = validateControllerInput(rawData);
      if (input) {
        inputCounter++;
        simulation.applyInput(input);

        // Immediate acknowledgment for sequence tracking
        socket.emit('ack', {
          sequence: input.sequence,
          clientTime: input.clientTime,
          serverTime: Date.now(),
        });
      }
    });

    socket.on('ping', (data: { clientTime: number }) => {
      socket.emit('pong', {
        clientTime: data?.clientTime || 0,
        serverTime: Date.now(),
      });
    });

    socket.on('reset', () => {
      simulation.resetPosition();
      console.log('[Socket.IO] Kart position reset.');
    });

    socket.on('disconnect', () => {
      if (controllerSocket && socket.id === controllerSocket.id) {
        console.log('[Socket.IO] Controller disconnected.');
        controllerSocket = null;
        simulation.clearInput();
      }
      tvSockets.delete(socket);
      broadcastStatus();
    });
  });

  // Fixed 60Hz authoritative simulation loop
  const dt = CONSTANTS.SIMULATION_TIMESTEP_SEC;
  const simInterval = setInterval(() => {
    const start = performance.now();

    simulation.step(dt);
    tickCounter++;

    const kartState = simulation.getState();
    const lastAckSequence = simulation.getLastAckSequence();
    const tick = simulation.getTickCount();
    const serverTime = Date.now();

    const statePayload: GameStateMessage = {
      type: 'state',
      tick,
      serverTime,
      lastAckSequence,
      kart: kartState,
    };

    io.emit('state', statePayload);
    stateBroadcastCounter++;

    const elapsed = performance.now() - start;
    totalProcessingTime += elapsed;
  }, 1000 / CONSTANTS.SIMULATION_RATE_HZ);

  // 1-second rolling diagnostics window
  const statsInterval = setInterval(() => {
    currentTickRate = tickCounter;
    currentInputRate = inputCounter;
    currentStateRate = stateBroadcastCounter;
    currentAvgProcessingTimeMs = tickCounter > 0 ? totalProcessingTime / tickCounter : 0;

    io.emit('server_diagnostics', getDiagnostics());

    tickCounter = 0;
    inputCounter = 0;
    stateBroadcastCounter = 0;
    totalProcessingTime = 0;
  }, 1000);

  // Bind server on 0.0.0.0
  await new Promise<void>((resolve) => {
    server.listen(port, '0.0.0.0', () => resolve());
  });

  // Start port 80 forwarder so phone/TV can connect without typing ":3000"
  if (port !== 80) {
    try {
      const forwarder = http.createServer((req, res) => {
        const proxyReq = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: req.url,
            method: req.method,
            headers: req.headers,
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
          }
        );
        proxyReq.on('error', () => {
          res.writeHead(502);
          res.end('Bad Gateway');
        });
        req.pipe(proxyReq, { end: true });
      });

      forwarder.on('upgrade', (req, socket, head) => {
        socket.on('error', () => socket.destroy());
        const proxyReq = http.request({
          hostname: '127.0.0.1',
          port,
          path: req.url,
          method: req.method,
          headers: req.headers,
        });
        proxyReq.on('upgrade', (proxyRes, proxySocket) => {
          proxySocket.on('error', () => proxySocket.destroy());
          socket.on('error', () => proxySocket.destroy());
          try {
            socket.write(
              `HTTP/1.1 101 Switching Protocols\r\n` +
                Object.entries(proxyRes.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join('\r\n') +
                '\r\n\r\n'
            );
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
          } catch {
            socket.destroy();
            proxySocket.destroy();
          }
        });
        proxyReq.on('error', () => socket.destroy());
        proxyReq.end();
      });

      forwarder.listen(80, '0.0.0.0', () => {
        console.log(` ⚡ Easy Direct Link:   http://${lanIp}/controller (no :3000 needed)`);
      });
      forwarder.on('error', () => {});
    } catch {}
  }

  console.log(`\n============================================================`);
  console.log(` 🏎️  KART PARTY – Socket.IO + Node.js Real-Time Architecture`);
  console.log(`============================================================`);
  console.log(` 🌐 Server LAN IP:      ${lanIp}`);
  console.log(` 📺 TV Game Client:     ${tvUrl}`);
  console.log(` 📱 Mobile Controller:  ${controllerUrl}`);
  console.log(` 💻 Web Hub / Info:     ${hubUrl}`);
  console.log(`============================================================`);
  console.log(` 📲 SCAN WITH PHONE TO OPEN CONTROLLER:`);

  try {
    const asciiQr = await QRCode.toString(controllerUrl, {
      type: 'terminal',
      small: true,
    });
    console.log(asciiQr);
  } catch {
    console.log(`(ASCII QR generation skipped)`);
  }

  console.log(`============================================================`);
  console.log(` Ready for TV and Phone connections (Socket.IO + Node.js).\n`);

  return {
    server,
    io,
    port,
    lanIp,
    dispose: () => {
      clearInterval(simInterval);
      clearInterval(statsInterval);
      io.close();
      server.close();
    },
  };
}

// Auto-run if executed directly
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  startServer().catch((err) => {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  });
}
