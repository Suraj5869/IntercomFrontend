import * as signalR from '@microsoft/signalr';
import { Injectable } from '@angular/core';
import { ChatMessage } from '../models/ChatMessage';

@Injectable({
  providedIn: 'root',
})
export class SignalRService {
  // 'https://intercombackend-5h0c.onrender.com/rideHub'
  private hubConnection!: signalR.HubConnection;
  public startConnection(): Promise<void> {
    this.hubConnection = new signalR.HubConnectionBuilder()
      .withUrl('https://intercombackend-5h0c.onrender.com/rideHub', {
        accessTokenFactory: () => localStorage.getItem('token') || '',
      }) // your API URL
      .withAutomaticReconnect()
      .build();

    return this.hubConnection
      .start()
      .then(() => console.log('SignalR Connected'))
      .catch((err) => console.log('Error while starting connection: ' + err));
  }

  public joinRoom(roomCode: string, userId: string) {
    console.log('Joining room with:', roomCode, userId);
    this.hubConnection.invoke('JoinRoom', roomCode, userId);
  }

  public leaveRoom(roomCode: string) {
    this.hubConnection.invoke('LeaveRoom', roomCode);
  }

    get connectionId(): string | null {
    return this.hubConnection.connectionId;
  }

  public sendMessage(
    roomCode: string,
    message: string,
    senderId: string,
    senderName: string,
  ) {
    this.hubConnection.invoke(
      'SendMessage',
      roomCode,
      message,
      senderId,
      senderName,
    );
  }

  public onReceiveMessage(callback: (message: ChatMessage) => void) {
    this.hubConnection.on('ReceiveMessage', callback);
  }

  sendOffer(roomCode: string, targetConnectionId: string, offer: any) {
    this.hubConnection.invoke('SendOffer', roomCode, targetConnectionId, JSON.stringify(offer));
  }

  sendAnswer(roomCode: string, targetConnectionId: string, answer: any) {
    this.hubConnection.invoke('SendAnswer', roomCode, targetConnectionId, JSON.stringify(answer));
  }

  sendIceCandidate(roomCode: string, targetConnectionId: string, candidate: any) {
    this.hubConnection.invoke(
      'SendIceCandidate',
      roomCode,
      targetConnectionId,
      JSON.stringify(candidate),
    );
  }

  onReceiveOffer(callback: (fromConnectionId: string, offer: any) => void) {
    this.hubConnection.on('ReceiveOffer', (fromConnectionId, offer) => {
      callback(fromConnectionId, JSON.parse(offer));
    });
  }

  onReceiveAnswer(callback: (fromConnectionId: string, answer: any)=> void) {
    this.hubConnection.on('ReceiveAnswer', (fromConnectionId, answer) => {
      callback(fromConnectionId, JSON.parse(answer));
    });
  }

  onReceiveIceCandidate(callback: (fromConnectionId: string, candidate: any) => void) {
    this.hubConnection.on('ReceiveIceCandidate', (fromConnectionId, candidate) => {
      callback(fromConnectionId, JSON.parse(candidate));
    });
  }

  onUsersUpdate(callback: any) {
    this.hubConnection.on('UsersInRoom', (users) => {
      callback(users);
    });
  }

   onPeerLeft(callback: (connectionId: string) => void) {
    this.hubConnection.on('PeerLeft', callback);
  }

  updateSpeaking(roomCode: string, userId: string, isSpeaking: boolean) {
    this.hubConnection.invoke('UpdateSpeaking', roomCode, userId, isSpeaking);
  }

  onUserSpeaking(callback: any) {
    this.hubConnection.on('UserSpeaking', callback);
  }

  onPlaylistUpdated(callback: any) {
    this.hubConnection.on('PlaylistUpdated', callback);
  }
  onPlaylistSongRemoved(callback: (songId: string) => void) {
    this.hubConnection.on('PlaylistSongRemoved', callback);
  }

  // --- Music playback (shared jukebox) ---

  playMusic(
    roomCode: string,
    songId: string,
    songUrl: string,
    songName: string,
  ) {
    this.hubConnection.invoke('PlayMusic', roomCode, songId, songUrl, songName);
  }

  pauseMusic(roomCode: string, positionSeconds: number) {
    this.hubConnection.invoke('PauseMusic', roomCode, positionSeconds);
  }

  stopMusic(roomCode: string) {
    this.hubConnection.invoke('StopMusic', roomCode);
  }

  resumeMusic(roomCode: string) {
    this.hubConnection.invoke('ResumeMusic', roomCode);
  }

  notifySongEnded(roomCode: string, roomId: string, songId: string) {
    this.hubConnection.invoke('NotifySongEnded', roomCode, roomId, songId);
  }

  onMusicPlay(
    callback: (data: {
      songId: string;
      songUrl: string;
      songName: string;
      startTime: string;
    }) => void,
  ) {
    this.hubConnection.on('MusicPlay', callback);
  }

  onMusicPause(callback: (position: number) => void) {
    this.hubConnection.on('MusicPause', callback);
  }

  onMusicStop(callback: () => void) {
    this.hubConnection.on('MusicStop', callback);
  }

  onMusicError(callback: (message: string) => void) {
    this.hubConnection.on('MusicError', callback);
  }
}
