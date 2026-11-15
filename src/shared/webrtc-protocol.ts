export interface PairedDeviceRecord {
  deviceId: string;
  name: string;
  token: string;
  approvedAt: number;
  lastSeen: number;
}

export interface PairingRequest {
  deviceId: string;
  deviceName: string;
  token?: string;
  roomCode?: string;
}

export interface PairingResponse {
  status: 'approved' | 'pending' | 'rejected';
  deviceId: string;
  token: string;
  name: string;
}

export interface WebRtcSignalMessage {
  target: 'tv' | 'controller';
  senderId?: string;
  type: 'offer' | 'answer' | 'ice-candidate';
  payload: any;
}

export const DEFAULT_ROOM_CODE = 'KART';

export const WEBRTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
  iceCandidatePoolSize: 4,
};

export const DATA_CHANNEL_CONFIG: RTCDataChannelInit = {
  ordered: false,      // Out-of-order UDP stream: latest packet always takes priority
  maxRetransmits: 0,   // Zero retransmits = 0 head-of-line blocking, lowest possible latency
};
