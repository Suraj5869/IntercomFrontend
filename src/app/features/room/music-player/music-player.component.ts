import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, Input, OnInit, ViewChild } from '@angular/core';
import { SignalRService } from 'src/app/core/services/signalr.service';
import { ToastService } from 'src/app/core/services/toast.service';
import { environment } from 'src/environments/environment';

interface Song {
  id: string;
  songUrl: string;
  songName: string;
}

@Component({
  selector: 'app-music-player',
  templateUrl: './music-player.component.html',
  styleUrls: ['./music-player.component.css'],
})
export class MusicPlayerComponent implements OnInit {
  @Input() roomCode: string = '';
  @Input() roomId: string = '';
  @Input() isCreator: boolean = false;

  @ViewChild('audioEl') audioEl!: ElementRef<HTMLAudioElement>;

  playlist: Song[] = [];
  currentSongId: string = '';
  isPlaying: boolean = false;
  uploading: boolean = false;
  userId: string = '';

  api = `${environment.apiUrl}/Music`;

  private driftCheckHandle: any = null;

  constructor(
    private signalR: SignalRService,
    private http: HttpClient,
    private toast: ToastService,
  ) {}

  ngOnInit() {
    this.userId = localStorage.getItem('userId') || '';

    this.http
      .get<Song[]>(`${this.api}/playlist/${this.roomId}`)
      .subscribe((songs) => (this.playlist = songs));

    this.signalR.onPlaylistUpdated((song: Song) => this.playlist.push(song));

    this.signalR.onPlaylistSongRemoved((songId: string) => {
      this.playlist = this.playlist.filter((s) => s.id !== songId);
    });

    this.signalR.onMusicPlay((data) => this.handlePlay(data));
    this.signalR.onMusicPause((position: number) => this.handlePause(position));
    this.signalR.onMusicStop(() => this.handleStop());

    this.signalR.onMusicError((message: string) => {
      this.toast.showToast({ type: 'info', message });
    });
  }

  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.mp3')) {
      this.toast.showToast({ type: 'info', message: 'Only .mp3 files are supported' });
      return;
    }

    this.uploading = true;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('roomId', this.roomId);
    formData.append('userId', this.userId);
    formData.append('roomCode', this.roomCode);

    this.http.post(`${this.api}/upload`, formData).subscribe({
      next: () => {
        this.uploading = false;
        event.target.value = '';
      },
      error: () => {
        this.uploading = false;
        this.toast.showToast({ type: 'info', message: 'Upload failed' });
      },
    });
  }

  playSong(song: Song) {
    this.signalR.playMusic(this.roomCode, song.id, song.songUrl, song.songName);
  }

  // Backend also rejects this for non-creators, but hiding the control
  // in the template keeps the UI honest for everyone else.
  removeSong(song: Song) {
    if (!this.isCreator) return;
    this.http.delete(`${this.api}/playlist/${song.id}/room/${this.roomCode}`).subscribe({
      error: () => this.toast.showToast({ type: 'info', message: 'Only the room creator can remove songs' }),
    });
  }


  togglePause() {
    const audio = this.audioEl.nativeElement;
    if (this.isPlaying) {
      this.signalR.pauseMusic(this.roomCode, audio.currentTime);
    }
  }

  private handlePlay(data: { songId: string; songUrl: string; songName: string; startTime: string }) {
    const audio = this.audioEl.nativeElement;
    audio.src = data.songUrl;
    this.currentSongId = data.songId;

    const startTimeMs = new Date(data.startTime).getTime();
    const delayMs = startTimeMs - Date.now();

    audio.oncanplaythrough = () => {
      audio.oncanplaythrough = null;
      const play = () => {
        const offset = (Date.now() - startTimeMs) / 1000;
        audio.currentTime = Math.max(0, offset);
        audio.play();
        this.isPlaying = true;
        this.startDriftCorrection(startTimeMs);
      };
      delayMs > 0 ? setTimeout(play, delayMs) : play();
    };

    audio.onended = () => {
      this.signalR.notifySongEnded(this.roomCode, this.roomId, data.songId);
    };
  }

  private startDriftCorrection(startTimeMs: number) {
    if (this.driftCheckHandle) clearInterval(this.driftCheckHandle);

    this.driftCheckHandle = setInterval(() => {
      const audio = this.audioEl?.nativeElement;
      if (!audio || audio.paused) {
        clearInterval(this.driftCheckHandle);
        return;
      }
      const expected = (Date.now() - startTimeMs) / 1000;
      if (Math.abs(audio.currentTime - expected) > 0.35) {
        audio.currentTime = expected;
      }
    }, 3000);
  }

  private handlePause(position: number) {
    const audio = this.audioEl.nativeElement;
    audio.currentTime = position;
    audio.pause();
    this.isPlaying = false;
    if (this.driftCheckHandle) clearInterval(this.driftCheckHandle);
  }

  private handleStop() {
    const audio = this.audioEl.nativeElement;
    audio.pause();
    audio.src = '';
    this.isPlaying = false;
    this.currentSongId = '';
    if (this.driftCheckHandle) clearInterval(this.driftCheckHandle);
  }
}
