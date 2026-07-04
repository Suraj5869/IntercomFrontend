import * as signalR from '@microsoft/signalr';
import { Injectable } from '@angular/core';
import { ChatMessage } from '../models/ChatMessage';

@Injectable({
  providedIn: 'root',
})
export class SignalRService {
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

  sendOffer(roomCode: string, offer: any) {
    this.hubConnection.invoke('SendOffer', roomCode, JSON.stringify(offer));
  }

  sendAnswer(roomCode: string, answer: any) {
    this.hubConnection.invoke('SendAnswer', roomCode, JSON.stringify(answer));
  }

  sendIceCandidate(roomCode: string, candidate: any) {
    this.hubConnection.invoke(
      'SendIceCandidate',
      roomCode,
      JSON.stringify(candidate),
    );
  }

  onReceiveOffer(callback: any) {
    this.hubConnection.on('ReceiveOffer', (offer) => {
      callback(JSON.parse(offer));
    });
  }

  onReceiveAnswer(callback: any) {
    this.hubConnection.on('ReceiveAnswer', (answer) => {
      callback(JSON.parse(answer));
    });
  }

  onReceiveIceCandidate(callback: any) {
    this.hubConnection.on('ReceiveIceCandidate', (candidate) => {
      callback(JSON.parse(candidate));
    });
  }

  onUsersUpdate(callback: any) {
    this.hubConnection.on('UsersInRoom', (users) => {
      callback(users);
    });
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
