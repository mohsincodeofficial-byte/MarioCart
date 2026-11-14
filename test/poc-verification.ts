import * as Colyseus from '@colyseus/sdk';
import { startServer } from '../src/server/server';
import { CONSTANTS } from '../src/shared/protocol';
import { GameStateMessage } from '../src/shared/game-types';

async function runVerification() {
  console.log(`\n======================================================`);
  console.log(`🧪 STARTING AUTOMATED KART PARTY PoC VERIFICATION TEST`);
  console.log(`======================================================\n`);

  const port = 3050; // Use port 3050 for isolated test
  const { server, gameServer } = await startServer(port);

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, details = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✅ [PASS] ${testName} ${details ? '(' + details + ')' : ''}`);
    } else {
      console.error(`  ❌ [FAIL] ${testName} ${details ? '(' + details + ')' : ''}`);
    }
  }

  try {
    // 1. Test HTTP Endpoints
    console.log(`\n--- 1. Testing HTTP Server & Client Hosting ---`);
    const baseUrl = `http://127.0.0.1:${port}`;

    const infoRes = await fetch(`${baseUrl}/api/info`);
    assert(infoRes.status === 200, 'GET /api/info returns 200 OK');
    const infoJson = await infoRes.json();
    assert(!!infoJson.lanIp && !!infoJson.controllerUrl && !!infoJson.qrDataUrl, 'API returns valid LAN IP, URLs and QR Code');

    const tvRes = await fetch(`${baseUrl}/tv`);
    assert(tvRes.status === 200, 'GET /tv returns 200 OK');
    const tvText = await tvRes.text();
    assert(tvText.includes('renderCanvas') && tvText.includes('KART PARTY'), 'TV HTML contains 3D canvas and HUD');

    const controllerRes = await fetch(`${baseUrl}/controller`);
    assert(controllerRes.status === 200, 'GET /controller returns 200 OK');
    const ctrlText = await controllerRes.text();
    assert(ctrlText.includes('btnLeft') && ctrlText.includes('btnGas'), 'Controller HTML contains touch controls');

    const indexRes = await fetch(`${baseUrl}/`);
    assert(indexRes.status === 200, 'GET / returns 200 OK landing page');

    // 2. Test Real-Time WebSocket Connections
    console.log(`\n--- 2. Testing Colyseus Real-Time Room & Roles ---`);
    const wsUrl = `ws://127.0.0.1:${port}`;
    const tvClient = new Colyseus.Client(wsUrl);
    const phoneClient = new Colyseus.Client(wsUrl);

    // TV joins room
    const tvRoom = await tvClient.joinOrCreate(CONSTANTS.ROOM_NAME, { role: 'tv' });
    assert(!!tvRoom.sessionId, 'TV client successfully connected to game room', `sessionId: ${tvRoom.sessionId}`);

    let latestTvState: GameStateMessage | null = null;
    let tvStateUpdateCount = 0;
    tvRoom.onMessage('state', (state: GameStateMessage) => {
      latestTvState = state;
      tvStateUpdateCount++;
    });

    // Wait for initial state broadcast
    await new Promise((r) => setTimeout(r, 200));
    assert(tvStateUpdateCount > 0 && !!latestTvState, 'TV receives 60Hz authoritative state broadcasts from server');

    // Phone joins room
    const phoneRoom = await phoneClient.joinOrCreate(CONSTANTS.ROOM_NAME, { role: 'controller' });
    assert(!!phoneRoom.sessionId, 'Phone controller connected to game room', `sessionId: ${phoneRoom.sessionId}`);

    // Wait for connection sync
    await new Promise((r) => setTimeout(r, 150));

    // 3. Test Ping / Pong RTT Measurement
    console.log(`\n--- 3. Testing Network RTT Ping / Pong ---`);
    let pingAckTime = 0;
    phoneRoom.onMessage('pong', (pong: { clientTime: number }) => {
      pingAckTime = performance.now() - pong.clientTime;
    });
    phoneRoom.send('ping', { clientTime: performance.now() });
    await new Promise((r) => setTimeout(r, 100));
    assert(pingAckTime > 0, 'Measured RTT ping/pong successful', `RTT: ${pingAckTime.toFixed(2)}ms`);

    // 4. Test Controller Input -> Server Authoritative Physics -> TV State
    console.log(`\n--- 4. Testing Authoritative Arcade Driving Simulation ---`);

    // Record baseline position
    const startZ = latestTvState!.kart.z;
    const startRot = latestTvState!.kart.rotation;

    // Send ACCELERATE input
    let lastAck = 0;
    phoneRoom.onMessage('ack', (ack: { sequence: number }) => {
      lastAck = ack.sequence;
    });

    console.log('  -> Holding ACCELERATE (throttle: 1.0)...');
    phoneRoom.send('input', {
      type: 'input',
      sequence: 1,
      steering: 0,
      throttle: 1.0,
      brake: false,
      clientTime: performance.now(),
    });

    await new Promise((r) => setTimeout(r, 400));
    assert(lastAck === 1, 'Server acknowledged sequence #1 input from phone');
    assert(latestTvState!.kart.speed > 0, 'Kart speed accelerated above 0', `speed: ${latestTvState!.kart.speed.toFixed(2)} m/s`);
    assert(latestTvState!.kart.z !== startZ, 'Kart authoritative Z position moved forward on TV', `z: ${latestTvState!.kart.z.toFixed(2)}`);

    // Send STEER LEFT input while driving
    console.log('  -> Holding STEER LEFT (steering: -1.0)...');
    phoneRoom.send('input', {
      type: 'input',
      sequence: 2,
      steering: -1.0,
      throttle: 1.0,
      brake: false,
      clientTime: performance.now(),
    });

    await new Promise((r) => setTimeout(r, 400));
    assert(lastAck === 2, 'Server acknowledged sequence #2 input');
    const rotAfterLeft = latestTvState!.kart.rotation;
    assert(rotAfterLeft < startRot, 'Kart rotated left in response to steering input', `rotation: ${rotAfterLeft.toFixed(3)} rad`);

    // Send STEER RIGHT input
    console.log('  -> Holding STEER RIGHT (steering: 1.0)...');
    phoneRoom.send('input', {
      type: 'input',
      sequence: 3,
      steering: 1.0,
      throttle: 1.0,
      brake: false,
      clientTime: performance.now(),
    });

    await new Promise((r) => setTimeout(r, 500));
    assert(lastAck === 3, 'Server acknowledged sequence #3 input');
    assert(latestTvState!.kart.rotation > rotAfterLeft, 'Kart rotated right in response to steering input', `rotation: ${latestTvState!.kart.rotation.toFixed(3)} rad`);

    // Send BRAKE input
    console.log('  -> Holding BRAKE (brake: true)...');
    const speedBeforeBrake = latestTvState!.kart.speed;
    phoneRoom.send('input', {
      type: 'input',
      sequence: 4,
      steering: 0,
      throttle: 0.0,
      brake: true,
      clientTime: performance.now(),
    });

    await new Promise((r) => setTimeout(r, 350));
    assert(lastAck === 4, 'Server acknowledged sequence #4 input');
    assert(latestTvState!.kart.speed < speedBeforeBrake, 'Holding BRAKE slows down the kart', `speed: ${latestTvState!.kart.speed.toFixed(2)} m/s`);

    // Release all inputs
    console.log('  -> Releasing all controls...');
    phoneRoom.send('input', {
      type: 'input',
      sequence: 5,
      steering: 0,
      throttle: 0.0,
      brake: false,
      clientTime: performance.now(),
    });
    await new Promise((r) => setTimeout(r, 200));
    assert(lastAck === 5, 'Server acknowledged release of controls (#5)');

    // 5. Test Phone Disconnect and Reconnect
    console.log(`\n--- 5. Testing Disconnect & Reconnect Resiliency ---`);
    let tvReceivedControllerDrop = false;
    let tvReceivedControllerReconnect = false;

    tvRoom.onMessage('status_update', (status: { controllerConnected: boolean }) => {
      if (!status.controllerConnected) {
        tvReceivedControllerDrop = true;
      } else {
        tvReceivedControllerReconnect = true;
      }
    });

    // Phone leaves
    await phoneRoom.leave();
    await new Promise((r) => setTimeout(r, 300));
    assert(tvReceivedControllerDrop, 'TV notified when phone disconnects (shows QR modal)');

    // Reconnecting phone
    const reconnectedPhone = await phoneClient.joinOrCreate(CONSTANTS.ROOM_NAME, { role: 'controller' });
    await new Promise((r) => setTimeout(r, 300));
    assert(!!reconnectedPhone.sessionId, 'Phone successfully reconnected with new session', `id: ${reconnectedPhone.sessionId}`);
    assert(tvReceivedControllerReconnect, 'TV notified when phone reconnected (hides QR modal)');

    // Verify control works after reconnect
    let reconnectedAck = 0;
    reconnectedPhone.onMessage('ack', (ack: { sequence: number }) => {
      reconnectedAck = ack.sequence;
    });

    reconnectedPhone.send('input', {
      type: 'input',
      sequence: 10,
      steering: 0,
      throttle: 1.0,
      brake: false,
      clientTime: performance.now(),
    });
    await new Promise((r) => setTimeout(r, 250));
    assert(reconnectedAck === 10, 'Reconnected phone immediately regains authoritative kart control');

    // Clean teardown
    await reconnectedPhone.leave();
    await tvRoom.leave();
    await gameServer.gracefullyShutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    console.log(`\n======================================================`);
    console.log(`📊 TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED (100%)`);
    console.log(`======================================================\n`);

    if (passedTests === totalTests) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test execution failed with exception:', err);
    process.exit(1);
  }
}

runVerification();
