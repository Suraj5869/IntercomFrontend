import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ChatMessage } from 'src/app/core/models/ChatMessage';
import { SignalRService } from 'src/app/core/services/signalr.service';
import { ToastService } from 'src/app/core/services/toast.service';
import { environment } from 'src/environments/environment';

interface RoomUser {
  connectionId: string;
  id: string;
  name: string;
}

// Everything needed to run one RTCPeerConnection to one remote peer.
// Previously the component kept a single shared peerConnection for the
// whole room, which only worked by accident with exactly 2 people —
// with 3+, offers/answers meant for different peer pairs were all applied
// to the same connection, corrupting its signaling state and producing
// "Called in wrong state: stable".
interface PeerLink {
  connection: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  pendingCandidates: RTCIceCandidateInit[];
  makingOffer: boolean;
}

@Component({
  selector: 'app-room',
  templateUrl: './room.component.html',
  styleUrls: ['./room.component.css'],
})
export class RoomComponent implements OnInit, OnDestroy {
  roomCode: string = '';
  message: string = '';
  messages: ChatMessage[] = [];
  createRoomCode: string = '';
  userId: string = '';
  userName: string = '';
  localStream!: MediaStream;
  isMicOn: boolean = false;

  // Remote <audio> elements are created in code and appended here instead
  // of being bound to a single #remoteAudio ViewChild — there's one remote
  // peer's audio stream per connection now, not one.
  @ViewChild('remoteAudioContainer') remoteAudioContainer!: ElementRef<HTMLDivElement>;

  users: RoomUser[] = [];
  isSpeaking: boolean = false;
  private analyser!: AnalyserNode;
  private dataArray!: Uint8Array;
  speakingUsers: { [key: string]: boolean } = {};

  // One RTCPeerConnection per remote peer, keyed by their SignalR connectionId.
  private peers = new Map<string, PeerLink>();

  audioContext!: AudioContext;

  pttBtn: HTMLElement | null = null;
  pttLabel: HTMLElement | null = null;
  myMicDot: HTMLElement | null = null;

  roomId: string = '';
  isCreator: boolean = false;
  api = `${environment.apiUrl}/Room`;

  activeTab: 'chat' | 'map' = 'chat';

  private readonly iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
  ];

  constructor(
    private signalR: SignalRService,
    private router: Router,
    private toast: ToastService,
    private http: HttpClient,
  ) {}

  async ngOnInit() {
    this.roomId = localStorage.getItem('roomId') || '';
    this.roomCode = localStorage.getItem('roomCode') || '';
    this.userId = localStorage.getItem('userId') || '';
    this.userName = localStorage.getItem('userName') || '';
    this.isCreator = localStorage.getItem('roomCreatedBy') === this.userId;

    this.pttBtn = document.getElementById('ptt-btn');
    this.pttLabel = document.getElementById('ptt-label');
    this.myMicDot = document.getElementById('my-mic-dot');

    await this.signalR.startConnection();
    console.log('[room] SignalR connected, connectionId =', this.signalR.connectionId);
    await this.startLocalAudio();
    console.log('[room] local mic stream ready, tracks:', this.localStream.getAudioTracks());

    this.signalR.onUsersUpdate((users: RoomUser[]) => this.handleUsersUpdate(users));
    this.signalR.onPeerLeft((connectionId: string) => this.teardownPeer(connectionId));

    this.signalR.onReceiveOffer((fromConnectionId, offer) => this.handleOffer(fromConnectionId, offer));
    this.signalR.onReceiveAnswer((fromConnectionId, answer) => this.handleAnswer(fromConnectionId, answer));
    this.signalR.onReceiveIceCandidate((fromConnectionId, candidate) => this.handleIceCandidate(fromConnectionId, candidate));

    console.log('[room] joining room', this.roomCode, 'as', this.userId);
    this.signalR.joinRoom(this.roomCode, this.userId);

    this.signalR.onReceiveMessage((msg: ChatMessage) => {
      msg.isMine = msg.senderId === this.userId;
      this.messages.push(msg);
    });

    this.signalR.onUserSpeaking((userId: string, speaking: boolean) => {
      this.speakingUsers = {
        ...this.speakingUsers,
        [userId]: speaking,
      };
    });
  }

  ngOnDestroy() {
    for (const connectionId of Array.from(this.peers.keys())) {
      this.teardownPeer(connectionId);
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
  }

  // --- Room membership -> peer connection lifecycle -----------------------

  private async handleUsersUpdate(users: RoomUser[]) {
    console.log('[room] UsersInRoom received:', users);
    this.users = users;
    const myConnectionId = this.signalR.connectionId;
    console.log('[room] my connectionId:', myConnectionId);
    if (!myConnectionId) {
      console.warn('[room] no connectionId yet — cannot set up peer connections. Is startConnection() actually resolved before this fires?');
      return;
    }

    const seen = new Set<string>();

    for (const user of users) {
      if (user.connectionId === myConnectionId) continue;
      seen.add(user.connectionId);

      if (this.peers.has(user.connectionId)) continue;

      console.log('[room] creating peer link for', user.connectionId, user.name);
      const link = this.createPeerLink(user.connectionId);
      this.peers.set(user.connectionId, link);

      // Deterministic tie-break so exactly one side initiates the offer
      // for each pair, even if both sides see the new roster at nearly
      // the same time (avoids offer/offer glare on simultaneous joins).
      const shouldInitiate = myConnectionId < user.connectionId;
      console.log('[room] shouldInitiate offer to', user.connectionId, '?', shouldInitiate);
      if (shouldInitiate) {
        await this.negotiate(user.connectionId, link);
      }
    }

    // Clean up peers that are no longer in the roster (in case a PeerLeft
    // event was missed).
    for (const connectionId of Array.from(this.peers.keys())) {
      if (!seen.has(connectionId)) {
        this.teardownPeer(connectionId);
      }
    }
  }

  private createPeerLink(remoteConnectionId: string): PeerLink {
    const connection = new RTCPeerConnection({ iceServers: this.iceServers });

    this.localStream.getTracks().forEach((track) => {
      connection.addTrack(track, this.localStream);
    });

    const audioEl = new Audio();
    audioEl.autoplay = true;
    // display:none can make some browsers (notably Safari/iOS) treat the
    // element as backgrounded and refuse to play it. Keep it in the DOM
    // and just visually invisible instead.
    audioEl.style.position = 'absolute';
    audioEl.style.width = '0';
    audioEl.style.height = '0';
    audioEl.style.opacity = '0';
    audioEl.style.pointerEvents = 'none';
    this.remoteAudioContainer?.nativeElement.appendChild(audioEl);

    const link: PeerLink = {
      connection,
      audioEl,
      pendingCandidates: [],
      makingOffer: false,
    };

    connection.ontrack = (event) => {
      link.audioEl.srcObject = event.streams[0];
      // Setting srcObject with autoplay=true doesn't guarantee playback —
      // the browser can silently block it (autoplay policy). Calling
      // play() explicitly surfaces the rejection so we can see it and
      // retry once we have a user gesture (see unlockRemoteAudio below).
      link.audioEl.play().catch((err) => {
        console.warn(`Remote audio blocked for peer ${remoteConnectionId}, will retry on next user interaction:`, err);
      });
    };

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalR.sendIceCandidate(this.roomCode, remoteConnectionId, event.candidate);
      }
    };

    connection.oniceconnectionstatechange = () => {
      console.log(`ICE state (${remoteConnectionId}):`, connection.iceConnectionState);
    };

    return link;
  }

  // Any user click (mic toggle, in this app) is a real user gesture, so
  // it's a safe place to retry play() on remote audio elements the
  // browser previously refused to autoplay, and to resume a suspended
  // AudioContext (needed for the speaking-indicator VAD, separate from
  // the actual WebRTC audio path).
  private unlockRemoteAudio() {
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    for (const link of this.peers.values()) {
      if (link.audioEl.paused) {
        link.audioEl.play().catch((err) => {
          console.warn('Remote audio still blocked after user gesture:', err);
        });
      }
    }
  }

  private async negotiate(remoteConnectionId: string, link: PeerLink) {
    try {
      link.makingOffer = true;
      const offer = await link.connection.createOffer();
      await link.connection.setLocalDescription(offer);
      this.signalR.sendOffer(this.roomCode, remoteConnectionId, link.connection.localDescription);
    } finally {
      link.makingOffer = false;
    }
  }

  private async handleOffer(fromConnectionId: string, offer: RTCSessionDescriptionInit) {
    let link = this.peers.get(fromConnectionId);
    if (!link) {
      // Offer arrived before we processed UsersInRoom for this peer — set
      // up the connection now rather than dropping the offer.
      link = this.createPeerLink(fromConnectionId);
      this.peers.set(fromConnectionId, link);
    }

    // Glare guard: if we're also mid-way through sending our own offer to
    // this same peer, only the "impolite" side (lower connectionId, per
    // the same tie-break used above) proceeds with its own offer; the
    // "polite" side backs off and accepts the incoming one.
    const myConnectionId = this.signalR.connectionId ?? '';
    const isPolite = myConnectionId > fromConnectionId;
    const offerCollision = link.makingOffer || link.connection.signalingState !== 'stable';

    if (offerCollision && !isPolite) {
      return; // ignore incoming offer, ours will win
    }

    if (offerCollision && isPolite) {
      await Promise.all([
        link.connection.setLocalDescription({ type: 'rollback' } as RTCLocalSessionDescriptionInit),
        link.connection.setRemoteDescription(offer),
      ]);
    } else {
      await link.connection.setRemoteDescription(offer);
    }

    await this.flushPendingCandidates(link);

    const answer = await link.connection.createAnswer();
    await link.connection.setLocalDescription(answer);
    this.signalR.sendAnswer(this.roomCode, fromConnectionId, link.connection.localDescription);
  }

  private async handleAnswer(fromConnectionId: string, answer: RTCSessionDescriptionInit) {
    const link = this.peers.get(fromConnectionId);
    if (!link) return;

    // Guard against a stray/duplicate answer landing on a connection
    // that's already back in "stable" — this is exactly what previously
    // threw "Called in wrong state: stable" once >2 peers were in a room.
    if (link.connection.signalingState !== 'have-local-offer') {
      return;
    }

    await link.connection.setRemoteDescription(answer);
    await this.flushPendingCandidates(link);
  }

  private async handleIceCandidate(fromConnectionId: string, candidate: RTCIceCandidateInit) {
    const link = this.peers.get(fromConnectionId);
    if (!link) return;

    if (link.connection.remoteDescription) {
      await link.connection.addIceCandidate(candidate);
    } else {
      link.pendingCandidates.push(candidate);
    }
  }

  private async flushPendingCandidates(link: PeerLink) {
    for (const candidate of link.pendingCandidates) {
      await link.connection.addIceCandidate(candidate);
    }
    link.pendingCandidates = [];
  }

  private teardownPeer(connectionId: string) {
    const link = this.peers.get(connectionId);
    if (!link) return;

    link.connection.ontrack = null;
    link.connection.onicecandidate = null;
    link.connection.close();
    link.audioEl.srcObject = null;
    link.audioEl.remove();

    this.peers.delete(connectionId);
  }

  // --- Local audio ----------------------------------------------------

  sendMessage() {
    this.signalR.sendMessage(
      this.roomCode,
      this.message,
      this.userId,
      localStorage.getItem('userName') || '',
    );
    this.message = '';
  }

  leaveRoom() {
    localStorage.removeItem('roomCode');
    this.signalR.leaveRoom(this.roomCode);
    this.router.navigate(['/dashboard']);
  }

  async startLocalAudio() {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.audioContext = new AudioContext();

    // initially mic OFF
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    this.isMicOn = false;

    this.startVoiceDetection();
  }

  startVoiceDetection() {
    const source = this.audioContext.createMediaStreamSource(this.localStream);

    const highPass = this.audioContext.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 100; // removes low hum

    const lowPass = this.audioContext.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 3000; // removes high noise

    source.connect(highPass);
    highPass.connect(lowPass);

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;

    source.connect(this.analyser);

    this.dataArray = new Uint8Array(this.analyser.fftSize);

    let speakingFrames = 0;
    let lastState = false;

    const detect = () => {
      this.analyser.getByteTimeDomainData(this.dataArray as any);

      let sum = 0;

      for (let i = 0; i < this.dataArray.length; i++) {
        const val = this.dataArray[i] - 128;
        sum += val * val;
      }

      const rms = Math.sqrt(sum / this.dataArray.length);

      // simple adaptive threshold (stable)
      const speaking = rms > 12;

      // debounce (prevents flicker)
      if (speaking) speakingFrames++;
      else speakingFrames = 0;

      const finalSpeaking = speakingFrames > 3;
      // ONLY send when state changes
      if (finalSpeaking !== lastState) {
        this.signalR.updateSpeaking(this.roomCode, this.userId, finalSpeaking);
        lastState = finalSpeaking;
      }

      requestAnimationFrame(detect);
    };

    detect();
  }

  toggleMic() {
    if (!this.localStream) return;

    this.unlockRemoteAudio();

    this.isMicOn = !this.isMicOn;

    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = this.isMicOn;
    });

    if (this.isMicOn) {
      this.pttBtn?.classList.remove('mic-off');
      this.pttBtn?.classList.add('mic-on');
      this.pttLabel?.classList.remove('mic-off');
      this.pttLabel?.classList.add('mic-on');
      this.pttLabel!.textContent = 'Transmitting...';
      this.myMicDot?.classList.remove('off');
      this.myMicDot?.classList.add('on');
    } else {
      this.pttBtn?.classList.remove('mic-on');
      this.pttBtn?.classList.add('mic-off');
      this.pttLabel?.classList.remove('mic-on');
      this.pttLabel?.classList.add('mic-off');
      this.pttLabel!.textContent = 'Mic is Muted';
      this.myMicDot?.classList.remove('on');
      this.myMicDot?.classList.add('off');
    }
  }

  shareRoom() {
    const roomLink = `${window.location.origin}/join/${this.roomCode}`;

    if (navigator.share) {
      navigator
        .share({
          title: 'Join my room',
          text: `Join my room using this code: ${this.roomCode}`,
          url: roomLink,
        })
        .catch((err) => console.log('Share cancelled', err));
    } else {
      navigator.clipboard.writeText(roomLink);
      this.toast.showToast({ type: 'info', message: 'Room link copied!' });
    }
  }
}