import { Socket } from 'socket.io-client';
import {
  WEBRTC_CONFIG,
  DATA_CHANNEL_CONFIG,
  PairingRequest,
  PairingResponse,
  WebRtcSignalMessage,
  DEFAULT_ROOM_CODE,
} from '../shared/webrtc-protocol';
import { InputManager } from './input';

export class WebRtcControllerClient {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private deviceId: string;
  private deviceName: string;
  private pairingToken: string = '';
  private isApproved = false;

  constructor(
    private socket: Socket,
    private inputManager: InputManager,
    private onStatusChange: (status: {
      paired: boolean;
      p2p: boolean;
      label: string;
    }) => void
  ) {
    this.deviceId = this.getOrCreateDeviceId();
    this.deviceName = this.detectDeviceName();
    this.extractUrlTokens();
    this.setupSignaling();
  }

  private getOrCreateDeviceId(): string {
    let id = localStorage.getItem('kart_device_id');
    if (!id) {
      id = 'oneplus_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
      localStorage.setItem('kart_device_id', id);
    }
    return id;
  }

  private detectDeviceName(): string {
    const saved = localStorage.getItem('kart_device_name');
    if (saved) return saved;

    const ua = navigator.userAgent;
    let name = 'Wireless Controller';
    if (/OnePlus/i.test(ua)) name = 'OnePlus Phone';
    else if (/Pixel/i.test(ua)) name = 'Google Pixel';
    else if (/Samsung|SM-/i.test(ua)) name = 'Samsung Galaxy';
    else if (/iPhone/i.test(ua)) name = 'Apple iPhone';
    else if (/Android/i.test(ua)) name = 'Android Phone';

    localStorage.setItem('kart_device_name', name);
    return name;
  }

  private extractUrlTokens(): void {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      this.pairingToken = token;
      localStorage.setItem('kart_pair_token', token);
    } else {
      this.pairingToken = localStorage.getItem('kart_pair_token') || '';
    }
  }

  public startPairing(): void {
    const req: PairingRequest = {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      token: this.pairingToken,
      roomCode: DEFAULT_ROOM_CODE,
    };

    console.log('[WebRTC Controller] Sending pairing request:', req);
    this.socket.emit('pair_controller', req);
  }

  private setupSignaling(): void {
    // 1. Pairing status received from server
    this.socket.on('pair_status', (res: PairingResponse) => {
      console.log('[WebRTC Controller] Pairing response:', res);
      if (res.status === 'approved') {
        this.isApproved = true;
        if (res.token) {
          this.pairingToken = res.token;
          localStorage.setItem('kart_pair_token', res.token);
        }
        this.onStatusChange({
          paired: true,
          p2p: false,
          label: `Paired: ${this.deviceName}`,
        });
        // Device approved: initiate direct WebRTC P2P connection to TV!
        this.initiateWebRtc();
      } else if (res.status === 'pending') {
        this.onStatusChange({
          paired: false,
          p2p: false,
          label: 'Waiting for TV Approval...',
        });
      }
    });

    // 2. WebRTC signals forwarded by server
    this.socket.on('webrtc_signal', async (msg: { type: string; payload: any }) => {
      if (!this.peerConnection) return;

      try {
        if (msg.type === 'answer') {
          console.log('[WebRTC Controller] Received answer SDP');
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(msg.payload));
        } else if (msg.type === 'ice-candidate' && msg.payload) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.payload));
        }
      } catch (err) {
        console.warn('[WebRTC Controller] Signaling error:', err);
      }
    });
  }

  /**
   * Initializes WebRTC PeerConnection, creates an unreliable, out-of-order DataChannel (raw UDP),
   * and sends the SDP offer to the TV screen via Socket.IO signaling.
   */
  public async initiateWebRtc(): Promise<void> {
    try {
      if (this.peerConnection) {
        this.peerConnection.close();
      }

      console.log('[WebRTC Controller] Creating RTCPeerConnection with STUN hole-punching...');
      this.peerConnection = new RTCPeerConnection(WEBRTC_CONFIG);

      // Handle ICE Candidates and send to TV
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          const signal: WebRtcSignalMessage = {
            target: 'tv',
            type: 'ice-candidate',
            payload: event.candidate.toJSON(),
          };
          this.socket.emit('webrtc_signal', signal);
        }
      };

      this.peerConnection.onconnectionstatechange = () => {
        console.log(`[WebRTC Controller] Connection State: ${this.peerConnection?.connectionState}`);
        if (this.peerConnection?.connectionState === 'connected') {
          this.onStatusChange({
            paired: true,
            p2p: true,
            label: '⚡ P2P UDP Active',
          });
        } else if (this.peerConnection?.connectionState === 'disconnected' || this.peerConnection?.connectionState === 'failed') {
          this.inputManager.setDataChannel(null);
          this.onStatusChange({
            paired: true,
            p2p: false,
            label: 'Paired (Socket Fallback)',
          });
        }
      };

      // Create pure UDP DataChannel for input stream
      this.dataChannel = this.peerConnection.createDataChannel('kart-input', DATA_CHANNEL_CONFIG);

      this.dataChannel.onopen = () => {
        console.log('[WebRTC Controller] 🚀 WebRTC DataChannel OPEN! Streaming inputs over raw UDP.');
        this.inputManager.setDataChannel(this.dataChannel);
        this.onStatusChange({
          paired: true,
          p2p: true,
          label: '⚡ P2P UDP Active (<10ms)',
        });
      };

      this.dataChannel.onclose = () => {
        console.log('[WebRTC Controller] DataChannel closed.');
        this.inputManager.setDataChannel(null);
        this.onStatusChange({
          paired: true,
          p2p: false,
          label: 'Paired (Socket Fallback)',
        });
      };

      this.dataChannel.onerror = (err) => {
        console.warn('[WebRTC Controller] DataChannel error:', err);
        this.inputManager.setDataChannel(null);
      };

      // Create and send SDP Offer
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);

      const signal: WebRtcSignalMessage = {
        target: 'tv',
        type: 'offer',
        payload: {
          sdp: offer.sdp,
          type: offer.type,
        },
      };
      this.socket.emit('webrtc_signal', signal);
      console.log('[WebRTC Controller] Sent SDP Offer to TV');
    } catch (err) {
      console.error('[WebRTC Controller] Failed to initiate WebRTC:', err);
    }
  }

  public getDeviceId(): string {
    return this.deviceId;
  }

  public getDeviceName(): string {
    return this.deviceName;
  }
}
