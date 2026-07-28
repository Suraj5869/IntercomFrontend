import * as signalR from '@microsoft/signalr';
import { Injectable } from '@angular/core';
import { ChatMessage } from '../models/ChatMessage';
import { RiderLocation } from '../models/RideLocation';
import { DestinationPoint } from '../models/DestinationPoint';

@Injectable({
  providedIn: 'root',
})
export class SignalRService {
  // https://intercombackend-5h0c.onrender.com/rideHub
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

  // Every signaling call now takes a targetConnectionId so the hub can
  // route it to exactly one peer instead of broadcasting to the room.
  get connectionId(): string | null {
    return this.hubConnection.connectionId;
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

  onReceiveAnswer(callback: (fromConnectionId: string, answer: any) => void) {
    this.hubConnection.on('ReceiveAnswer', (fromConnectionId, answer) => {
      callback(fromConnectionId, JSON.parse(answer));
    });
  }

  onReceiveIceCandidate(callback: (fromConnectionId: string, candidate: any) => void) {
    this.hubConnection.on('ReceiveIceCandidate', (fromConnectionId, candidate) => {
      callback(fromConnectionId, JSON.parse(candidate));
    });
  }

  onUsersUpdate(callback: (users: { connectionId: string; id: string; name: string }[]) => void) {
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

  onMusicSyncPaused(
    callback: (data: { songId: string; songUrl: string; songName: string; position: number }) => void,
  ) {
    this.hubConnection.on('MusicSyncPaused', callback);
  }

  onMusicStop(callback: () => void) {
    this.hubConnection.on('MusicStop', callback);
  }

  onMusicError(callback: (message: string) => void) {
    this.hubConnection.on('MusicError', callback);
  }

  // --- Live location / destination (map feature) ---

  // Creator-only — the hub re-checks this server-side via the JWT claim,
  // so this call will be rejected (LocationError) if invoked by anyone else.
  setDestination(roomCode: string, lat: number, lng: number, label: string) {
    this.hubConnection.invoke('SetDestination', roomCode, lat, lng, label);
  }

  // Throttle calls to this on the CALLER's side (e.g. every 8-10s or on
  // ~20m movement) — the hub broadcasts on every invoke with no throttling
  // of its own.
   updateLocation(
    roomCode: string,
    userId: string,
    userName: string,
    lat: number,
    lng: number,
    etaMinutes: number | null,
    travelMode: 'car' | 'bike'
  ) {
    this.hubConnection.invoke('UpdateLocation', roomCode, userId, userName, lat, lng, etaMinutes, travelMode);
  }

  stopSharingLocation(roomCode: string) {
    this.hubConnection.invoke('StopSharingLocation', roomCode);
  }

    // Any rider can propose/clear a meeting point — no creator restriction,
  // unlike setDestination.
  addStop(roomCode: string, lat: number, lng: number, label: string) {
    this.hubConnection.invoke('AddStop', roomCode, lat, lng, label);
  }

  clearStop(roomCode: string) {
    this.hubConnection.invoke('ClearStop', roomCode);
  }

  onStopSet(callback: (stop: DestinationPoint) => void) {
    this.hubConnection.on('StopSet', callback);
  }

  onStopCleared(callback: () => void) {
    this.hubConnection.on('StopCleared', callback);
  }

   // Call this once the map UI actually mounts — it may have missed the
  // one-time push JoinRoom sends, if the map tab wasn't open yet when the
  // room was first joined.
  requestMapState(roomCode: string) {
    this.hubConnection.invoke('RequestMapState', roomCode);
  }

  onDestinationSet(callback: (destination: DestinationPoint) => void) {
    this.hubConnection.on('DestinationSet', callback);
  }

  onLocationUpdated(callback: (location: RiderLocation) => void) {
    this.hubConnection.on('LocationUpdated', callback);
  }

  onLocationRemoved(callback: (connectionId: string) => void) {
    this.hubConnection.on('LocationRemoved', callback);
  }

  // Sent once to a client right after it joins, with everyone's last known
  // location at that point (mirrors how MusicPlay/MusicSyncPaused sync
  // late joiners).
  onAllLocations(callback: (locations: RiderLocation[]) => void) {
    this.hubConnection.on('AllLocations', callback);
  }

  onLocationError(callback: (message: string) => void) {
    this.hubConnection.on('LocationError', callback);
  }
}
