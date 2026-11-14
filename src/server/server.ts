import path from 'path';
import fs from 'fs';
import os from 'os';
import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { Server } from 'colyseus';
import { CONSTANTS } from '../shared/protocol';
import { GameRoom } from './game-room';

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
  const controllerUrl = `http://${lanIp}:${port}/controller`;
  const tvUrl = `http://${lanIp}:${port}/tv`;
  const hubUrl = `http://${lanIp}:${port}`;

  // Pre-generate QR Code as DataURL
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

  const distPath = path.resolve(process.cwd(), 'dist/client');
  const hasDist = fs.existsSync(distPath);

  // Setup Colyseus 0.18 Server with integrated Express routing & Matchmaker
  const gameServer = new Server({
    express: (app) => {
      app.use(cors());
      app.use(express.json());

      // API endpoint for clients to discover LAN endpoints and QR code
      app.get('/api/info', (_req, res) => {
        res.json({
          lanIp,
          port,
          hubUrl,
          tvUrl,
          controllerUrl,
          qrDataUrl,
        });
      });

      if (hasDist && process.env.NODE_ENV !== 'development') {
        console.log(`[HTTP] Serving pre-built client from: ${distPath}`);
        app.use(express.static(distPath));

        app.get('/tv', (_req, res) => {
          res.sendFile(path.join(distPath, 'tv.html'));
        });

        app.get('/controller', (_req, res) => {
          res.sendFile(path.join(distPath, 'controller.html'));
        });

        app.get('/', (_req, res) => {
          res.sendFile(path.join(distPath, 'index.html'));
        });
      } else {
        // Dev fallback
        app.get('/tv', (_req, res) => res.sendFile(path.resolve(process.cwd(), 'tv.html')));
        app.get('/controller', (_req, res) => res.sendFile(path.resolve(process.cwd(), 'controller.html')));
        app.get('/', (_req, res) => res.sendFile(path.resolve(process.cwd(), 'index.html')));
      }
    },
  });

  gameServer.define(CONSTANTS.ROOM_NAME, GameRoom);

  // Bind and listen on all network interfaces
  await gameServer.listen(port, '0.0.0.0');

  console.log(`\n============================================================`);
  console.log(` 🏎️  KART PARTY – Real-Time Technical Architecture PoC`);
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
  console.log(` Ready for TV and Phone connections. Press Ctrl+C to stop.\n`);

  return {
    server: gameServer.transport.server,
    gameServer,
    port,
    lanIp,
  };
}

// Auto-run if executed directly
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  startServer().catch((err) => {
    console.error('Fatal server startup error:', err);
    process.exit(1);
  });
}
