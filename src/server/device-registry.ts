import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PairedDeviceRecord } from '../shared/webrtc-protocol';

export class DeviceRegistry {
  private filePath: string;
  private devices = new Map<string, PairedDeviceRecord>();
  private sessionPairToken: string;

  constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {}
    }
    this.filePath = path.join(dataDir, 'paired-devices.json');
    // Generate an 8-character hex pairing token for this host session
    this.sessionPairToken = crypto.randomBytes(4).toString('hex');
    this.load();
  }

  public getSessionPairToken(): string {
    return this.sessionPairToken;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed: PairedDeviceRecord[] = JSON.parse(raw);
        for (const item of parsed) {
          this.devices.set(item.deviceId, item);
        }
        console.log(`[DeviceRegistry] Loaded ${this.devices.size} pre-approved controller(s).`);
      }
    } catch (err) {
      console.warn('[DeviceRegistry] Failed to load paired devices:', err);
    }
  }

  private save(): void {
    try {
      const arr = Array.from(this.devices.values());
      fs.writeFileSync(this.filePath, JSON.stringify(arr, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[DeviceRegistry] Failed to save paired devices:', err);
    }
  }

  public isAuthorized(deviceId: string, token?: string): boolean {
    const record = this.devices.get(deviceId);
    if (!record) return false;
    if (token && record.token === token) {
      record.lastSeen = Date.now();
      this.save();
      return true;
    }
    // If device was previously approved, allow reconnect
    record.lastSeen = Date.now();
    this.save();
    return true;
  }

  public isValidSessionToken(token?: string): boolean {
    if (!token) return false;
    return token.toLowerCase() === this.sessionPairToken.toLowerCase();
  }

  public registerAndApprove(deviceId: string, name: string, token?: string): PairedDeviceRecord {
    const existing = this.devices.get(deviceId);
    const assignedToken = token || existing?.token || crypto.randomBytes(8).toString('hex');

    const record: PairedDeviceRecord = {
      deviceId,
      name: name || 'Wireless Controller',
      token: assignedToken,
      approvedAt: existing?.approvedAt || Date.now(),
      lastSeen: Date.now(),
    };

    this.devices.set(deviceId, record);
    this.save();
    console.log(`[DeviceRegistry] Controller permanently authorized: "${record.name}" (${deviceId})`);
    return record;
  }

  public revoke(deviceId: string): boolean {
    const removed = this.devices.delete(deviceId);
    if (removed) this.save();
    return removed;
  }

  public list(): PairedDeviceRecord[] {
    return Array.from(this.devices.values());
  }
}
