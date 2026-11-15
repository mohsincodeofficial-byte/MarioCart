import { Socket } from 'socket.io-client';
import { WEBRTC_CONFIG, WebRtcSignalMessage } from '../shared/webrtc-protocol';
import { ControllerInput } from '../shared/game-types';

export class WebRtcTvHost {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private isP2pActive = false;

  constructor(
    private socket: Socket,
    private onDirectInput: (input: ControllerInput) => void,
    private onStatusChange: (status: { p2p: boolean; label: string; deviceName?: string }) => void
  ) {
    this.setupSignaling();
  }

  private setupSignaling(): void {
    // 1. Device pairing notification from server
    this.socket.on('controller_paired', (data: { deviceId: string; name: string }) => {
      console.log(`[WebRTC TV] Controller paired: "${data.name}" (${data.deviceId})`);
      this.onStatusChange({
        p2p: this.isP2pActive,
        label: `🎮 Controller: ${data.name}`,
        deviceName: data.name,
      });
    });

    // 2. Incoming pairing request from unknown device -> auto-approve for seamless play!
    this.socket.on('device_pairing_request', (data: { deviceId: string; name: string; socketId: string }) => {
      console.log(`[WebRTC TV] Device pairing requested: "${data.name}" -> Auto-Approving!`);
      this.socket.emit('approve_device', { deviceId: data.deviceId, name: data.name });
      this.onStatusChange({
        p2p: false,
        label: `Approved: ${data.name}`,
        deviceName: data.name,
      });
    });

    // 3. WebRTC signaling from Controller
    this.socket.on('webrtc_signal', async (msg: { senderId: string; type: string; payload: any }) => {
      try {
        if (msg.type === 'offer') {
          console.log('[WebRTC TV] Received SDP offer from controller, negotiating WebRTC P2P...');
          await this.handleOffer(msg.payload);
        } else if (msg.type === 'ice-candidate' && msg.payload) {
          if (this.peerConnection) {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(msg.payload));
          }
        }
      } catch (err) {
        console.warn('[WebRTC TV] Signaling error:', err);
      }
    });
  }

  private async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    this.peerConnection = new RTCPeerConnection(WEBRTC_CONFIG);

    // Forward ICE Candidates to Controller
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        const signal: WebRtcSignalMessage = {
          target: 'controller',
          type: 'ice-candidate',
          payload: event.candidate.toJSON(),
        };
        this.socket.emit('webrtc_signal', signal);
      }
    };

    // Receive the Controller's raw UDP DataChannel!
    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      console.log(`[WebRTC TV] Received DataChannel: "${this.dataChannel.label}"`);

      this.dataChannel.onopen = () => {
        console.log('[WebRTC TV] 🚀 P2P WebRTC DataChannel OPEN! Receiving zero-latency UDP input stream.');
        this.isP2pActive = true;
        this.onStatusChange({
          p2p: true,
          label: '⚡ P2P Direct UDP Active',
        });
      };

      this.dataChannel.onclose = () => {
        console.log('[WebRTC TV] P2P DataChannel closed.');
        this.isP2pActive = false;
        this.onStatusChange({
          p2p: false,
          label: 'Fallback to Socket.IO',
        });
      };

      this.dataChannel.onmessage = (e) => {
        try {
          const input: ControllerInput = JSON.parse(e.data);
          this.onDirectInput(input);
        } catch (err) {
          console.warn('[WebRTC TV] DataChannel message error:', err);
        }
      };
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log(`[WebRTC TV] PeerConnection state: ${this.peerConnection?.connectionState}`);
      if (this.peerConnection?.connectionState === 'connected') {
        this.isP2pActive = true;
        this.onStatusChange({
          p2p: true,
          label: '⚡ Direct WebRTC P2P (<10ms)',
        });
      } else if (this.peerConnection?.connectionState === 'disconnected' || this.peerConnection?.connectionState === 'failed') {
        this.isP2pActive = false;
        this.onStatusChange({
          p2p: false,
          label: 'Socket.IO Active',
        });
      }
    };

    // Set Remote Offer
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

    // Create & Send SDP Answer
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    const signal: WebRtcSignalMessage = {
      target: 'controller',
      type: 'answer',
      payload: {
        sdp: answer.sdp,
        type: answer.type,
      },
    };
    this.socket.emit('webrtc_signal', signal);
    console.log('[WebRTC TV] Sent SDP Answer to controller');
  }

  public getIsP2pActive(): boolean {
    return this.isP2pActive;
  }
}
