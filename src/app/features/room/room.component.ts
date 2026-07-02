import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ChatMessage } from 'src/app/core/models/ChatMessage';
import { SignalRService } from 'src/app/core/services/signalr.service';
import { ToastService } from 'src/app/core/services/toast.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-room',
  templateUrl: './room.component.html',
  styleUrls: ['./room.component.css'],
})
export class RoomComponent implements OnInit {
  roomCode: string = '';
  message: string = '';
  messages: ChatMessage[] = [];
  createRoomCode: string = '';
  userId: string = '';
  peerConnection!: RTCPeerConnection;
  localStream!: MediaStream;
  remoteStream!: MediaStream;
  isMicOn: boolean = false;
  @ViewChild('remoteAudio') remoteAudio!: ElementRef;
  pendingCandidates: any[] = [];
  users: { id: string; name: string }[] = [];
  isSpeaking: boolean = false;
  private analyser!: AnalyserNode;
  private dataArray!: Uint8Array;
  speakingUsers: { [key: string]: boolean } = {};

  audioContext!: AudioContext;

  pttBtn: HTMLElement | null = null;
  pttLabel: HTMLElement | null = null;
  myMicDot: HTMLElement | null = null;

  roomId: string = '';
  api = `${environment.apiUrl}/Room`;

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

    this.pttBtn = document.getElementById('ptt-btn');
    this.pttLabel = document.getElementById('ptt-label');
    this.myMicDot = document.getElementById('my-mic-dot');
    
    await this.signalR.startConnection();

    this.signalR.onUsersUpdate((users: { id: string; name: string }[]) => {
      this.users = users;
      console.log(this.users);
    });

    this.signalR.joinRoom(this.roomCode, this.userId);
    await this.startVoice(); // 🔥 ADD THIS

    this.signalR.onReceiveMessage((msg:ChatMessage) => {
      msg.isMine = msg.senderId === this.userId;
      console.log('Received message:', msg);
      this.messages.push(msg);
    });

    this.signalR.onReceiveOffer(async (offer: any) => {
      this.peerConnection.ontrack = (event) => {
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.play();
        console.log('Receiving audio stream');

        this.remoteAudio.nativeElement.srcObject = event.streams[0];
      };

      await this.peerConnection.setRemoteDescription(offer);

      // 🔥 ADD THIS
      for (const candidate of this.pendingCandidates) {
        await this.peerConnection.addIceCandidate(candidate);
        console.log('Flushed ICE');
      }
      this.pendingCandidates = [];

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      this.signalR.sendAnswer(this.roomCode, answer);
    });

    this.signalR.onReceiveAnswer(async (answer: any) => {
      await this.peerConnection.setRemoteDescription(answer);
      // 🔥 ADD THIS
      for (const candidate of this.pendingCandidates) {
        await this.peerConnection.addIceCandidate(candidate);
      }
      this.pendingCandidates = [];
    });

    this.signalR.onReceiveIceCandidate(async (candidate: any) => {
      console.log('Received ICE candidate');

      if (this.peerConnection && this.peerConnection.remoteDescription) {
        await this.peerConnection.addIceCandidate(candidate);
        console.log('ICE added');
      } else {
        console.log('Queueing ICE candidate');
        this.pendingCandidates.push(candidate);
      }
    });

    this.peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE state:', this.peerConnection.iceConnectionState);
    };

    this.signalR.onUserSpeaking((userId: string, speaking: boolean) => {
      this.speakingUsers = {
        ...this.speakingUsers,
        [userId]: speaking,
      };
    });
  }

  sendMessage() {
    this.signalR.sendMessage(this.roomCode, this.message, this.userId, localStorage.getItem('userName') || '');
    this.message = '';
  }

  leaveRoom() {
    localStorage.removeItem('roomCode');
    this.signalR.leaveRoom(this.roomCode);
    this.router.navigate(['/dashboard']);
  }

  async startVoice() {
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

    console.log('Audio Tracks:', this.localStream.getAudioTracks());

    this.peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }, // free STUN server
      ],
    });

    // send audio tracks
    this.localStream.getTracks().forEach((track) => {
      this.peerConnection.addTrack(track, this.localStream);
    });

    // receive remote audio
    this.peerConnection.ontrack = (event) => {
      this.remoteStream = event.streams[0];

      const audio = new Audio();
      audio.srcObject = this.remoteStream;
      audio.play();
    };

    // ICE candidate
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalR.sendIceCandidate(this.roomCode, event.candidate);
        console.log('Sending ICE:', event.candidate);
      }
    };

    // create offer
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    this.signalR.sendOffer(this.roomCode, offer);

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
    console.log('Mic is now:', this.isMicOn ? 'ON' : 'OFF');
  }

  shareRoom() {
    const roomLink = `${window.location.origin}/join/${this.roomCode}`;

    // 🔥 Try native sharing first (mobile + modern browsers)
    if (navigator.share) {
      navigator
        .share({
          title: 'Join my room',
          text: `Join my room using this code: ${this.roomCode}`,
          url: roomLink,
        })
        .catch((err) => console.log('Share cancelled', err));
    } else {
      // fallback → copy to clipboard
      navigator.clipboard.writeText(roomLink);
      this.toast.showToast({ type: 'info', message: 'Room link copied!' });
    }
  }
}
