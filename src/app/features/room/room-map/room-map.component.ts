import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import * as L from 'leaflet';
import { SignalRService } from 'src/app/core/services/signalr.service';
import { ToastService } from 'src/app/core/services/toast.service';
import { DestinationPoint } from 'src/app/core/models/DestinationPoint';
import { RiderLocation } from 'src/app/core/models/RideLocation';

// Leaflet's default marker icons reference image files by relative URL,
// which breaks under Angular's build (the files never end up where
// Leaflet's CSS expects them). Rebuilding the default icon from the
// package's own asset URLs avoids needing to hand-copy marker images
// into src/assets.
const DEFAULT_ICON = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const DESTINATION_ICON = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [30, 49],
  iconAnchor: [15, 49],
  popupAnchor: [1, -40],
  shadowSize: [49, 49],
  className: 'destination-marker-icon',
});

// Visually distinct from the final-destination marker (CSS hue-rotate,
// see room-map.component.css) so riders can tell "rally point" apart
// from "final destination" at a glance.
const STOP_ICON = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [28, 46],
  iconAnchor: [14, 46],
  popupAnchor: [1, -38],
  shadowSize: [46, 46],
  className: 'stop-marker-icon',
});

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

@Component({
  selector: 'app-room-map',
  templateUrl: './room-map.component.html',
  styleUrls: ['./room-map.component.css'],
})
export class RoomMapComponent implements AfterViewInit, OnDestroy {
  @Input() roomCode: string = '';
  @Input() userId: string = '';
  @Input() userName: string = '';
  @Input() isCreator: boolean = false;

  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>;

  isSharingLocation = false;
  isPlacingDestination = false;
  isPlacingStop = false;
  destination: DestinationPoint | null = null;
  stop: DestinationPoint | null = null;

  // --- Destination search / confirm state (creator only) ---
  destinationQuery = '';
  searchResults: NominatimResult[] = [];
  isSearching = false;
  pendingDestination: { lat: number; lng: number; label: string } | null = null;

  // --- Stop / meeting-point confirm state (any rider) ---
  pendingStop: { lat: number; lng: number; label: string } | null = null;

  private map!: L.Map;
  private riderMarkers = new Map<string, L.Marker>();
  private destinationMarker: L.Marker | null = null;
  private stopMarker: L.Marker | null = null;
  private previewDestinationMarker: L.Marker | null = null;
  private previewStopMarker: L.Marker | null = null;
  private myRouteLine: L.Polyline | null = null;

  private watchId: number | null = null;
  private lastSentAt = 0;
  private lastSentPos: { lat: number; lng: number } | null = null;

  // My own last-computed ETA to whatever the current route target is
  // (stop if active, else destination). Forwarded on every location
  // broadcast so other riders can display it above my marker.
  private myEtaMinutes: number | null = null;

  private searchDebounceTimer: any = null;

  // Throttle: don't send location on every GPS tick — only every
  // MIN_INTERVAL_MS or after MIN_DISTANCE_M of movement.
  private readonly MIN_INTERVAL_MS = 8000;
  private readonly MIN_DISTANCE_M = 20;

  // Routing recompute throttle is looser than the location-broadcast one —
  // OSRM's public demo server is rate-limited, and a route/ETA doesn't
  // need to be redrawn nearly as often as a marker needs to move.
  private lastRouteAt = 0;
  private lastRoutePos: { lat: number; lng: number } | null = null;
  private readonly ROUTE_MIN_INTERVAL_MS = 20000;
  private readonly ROUTE_MIN_DISTANCE_M = 100;

  constructor(
    private signalR: SignalRService,
    private toast: ToastService,
  ) {}

  ngAfterViewInit(): void {
    this.initMap();
    this.registerHubListeners();
     // Listeners above may have missed the one-time DestinationSet/StopSet/
    // AllLocations push that fired at JoinRoom time, if this component
    // (i.e. the Map tab) wasn't mounted yet when the room was joined —
    // this explicitly re-pulls current state so it isn't left stale/empty.
        this.signalR.requestMapState(this.roomCode);
  }

  ngOnDestroy(): void {
    this.stopSharingLocation();
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    this.map?.remove();
  }

  private initMap() {
    this.map = L.map(this.mapEl.nativeElement, {
      center: [20.5937, 78.9629], // sensible default before any markers exist
      zoom: 5,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.isPlacingDestination) {
        this.setPendingDestination(e.latlng.lat, e.latlng.lng, 'Dropped pin');
        this.isPlacingDestination = false;
      } else if (this.isPlacingStop) {
        this.setPendingStop(e.latlng.lat, e.latlng.lng, 'Meeting point');
        this.isPlacingStop = false;
      }
    });
  }

  private registerHubListeners() {
    this.signalR.onDestinationSet((destination) => {
      this.destination = destination;
      this.renderDestination(destination);
      this.clearPendingDestinationPreview();
      this.fitBounds();
      // The active stop (if any) stays the routing priority — destination
      // only becomes the live target once there's no stop to rally at.
      if (!this.stop) {
        this.computeMyRoute(destination, true);
      }
    });

    this.signalR.onStopSet((stop) => {
      this.stop = stop;
      this.renderStop(stop);
      this.clearPendingStopPreview();
      this.fitBounds();
      this.computeMyRoute(stop, true);
    });

    this.signalR.onStopCleared(() => {
      if (this.stopMarker) {
        this.map.removeLayer(this.stopMarker);
        this.stopMarker = null;
      }
      this.stop = null;
      if (this.destination) {
        this.computeMyRoute(this.destination, true);
      } else {
        this.clearMyRoute();
      }
    });

    this.signalR.onLocationUpdated((location) => {
      this.renderRider(location);
      this.fitBounds();
    });

    this.signalR.onLocationRemoved((connectionId) => {
      const marker = this.riderMarkers.get(connectionId);
      if (marker) {
        this.map.removeLayer(marker);
        this.riderMarkers.delete(connectionId);
      }
    });

    this.signalR.onAllLocations((locations) => {
      locations.forEach((loc) => this.renderRider(loc));
      this.fitBounds();
    });

    this.signalR.onLocationError((message) => {
      this.toast.showToast({ type: 'error', message });
    });
  }

  private renderDestination(destination: DestinationPoint) {
    const pos: L.LatLngExpression = [destination.lat, destination.lng];
    if (this.destinationMarker) {
      this.destinationMarker.setLatLng(pos);
    } else {
      this.destinationMarker = L.marker(pos, { icon: DESTINATION_ICON })
        .addTo(this.map)
        .bindPopup(`🏁 ${destination.label || 'Destination'}`);
    }
  }

  private renderStop(stop: DestinationPoint) {
    const pos: L.LatLngExpression = [stop.lat, stop.lng];
    if (this.stopMarker) {
      this.stopMarker.setLatLng(pos);
    } else {
      this.stopMarker = L.marker(pos, { icon: STOP_ICON })
        .addTo(this.map)
        .bindPopup(`🚩 Meeting point: ${stop.label || 'Stop'}`);
    }
  }

  private renderRider(location: RiderLocation) {
    const pos: L.LatLngExpression = [location.lat, location.lng];
    const existing = this.riderMarkers.get(location.connectionId);
    const etaText = this.formatEtaTooltip(location);

    if (existing) {
      existing.setLatLng(pos);
      existing.setPopupContent(this.riderPopupText(location));
      this.applyEtaTooltip(existing, etaText);
    } else {
      const marker = L.marker(pos, { icon: DEFAULT_ICON })
        .addTo(this.map)
        .bindPopup(this.riderPopupText(location));
      this.applyEtaTooltip(marker, etaText);
      this.riderMarkers.set(location.connectionId, marker);
    }
  }

  private applyEtaTooltip(marker: L.Marker, etaText: string | null) {
    if (!etaText) return;
    if (marker.getTooltip()) {
      marker.setTooltipContent(etaText);
    } else {
      marker.bindTooltip(etaText, {
        permanent: true,
        direction: 'top',
        offset: [0, -36],
        className: 'eta-tooltip',
      });
    }
  }

  private formatEtaTooltip(location: RiderLocation): string | null {
    if (location.etaMinutes == null) return null;
    const mins = Math.round(location.etaMinutes);
    return mins < 1 ? 'Arriving' : `${mins} min`;
  }

  private riderPopupText(location: RiderLocation): string {
    const isMe = location.userId === this.userId;
    return `${isMe ? '🟡 You' : '🏍️ ' + location.userName}`;
  }

  private fitBounds() {
    const points: L.LatLngExpression[] = [
      ...Array.from(this.riderMarkers.values()).map((m) => m.getLatLng()),
    ];
    if (this.destinationMarker) points.push(this.destinationMarker.getLatLng());
    if (this.stopMarker) points.push(this.stopMarker.getLatLng());

    if (points.length === 0) return;
    if (points.length === 1) {
      this.map.setView(points[0], 14);
    } else {
      this.map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    }
  }

  // --- Creator: search for a destination (Nominatim) ---

  onDestinationQueryChange(value: string) {
    this.destinationQuery = value;
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);

    if (value.trim().length < 3) {
      this.searchResults = [];
      return;
    }

    // Debounce so we don't hammer Nominatim's free public endpoint on
    // every keystroke — their usage policy caps this at ~1 req/sec.
    this.searchDebounceTimer = setTimeout(() => this.searchNominatim(value), 450);
  }

  private async searchNominatim(query: string) {
    this.isSearching = true;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Search failed: ${res.status}`);
      this.searchResults = await res.json();
    } catch (err) {
      console.warn('Nominatim search failed', err);
      this.toast.showToast({ type: 'error', message: 'Address search failed — try again' });
      this.searchResults = [];
    } finally {
      this.isSearching = false;
    }
  }

  selectSearchResult(result: NominatimResult) {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    this.destinationQuery = result.display_name;
    this.searchResults = [];
    this.setPendingDestination(lat, lng, result.display_name);
  }

  private setPendingDestination(lat: number, lng: number, label: string) {
    this.pendingDestination = { lat, lng, label };

    const pos: L.LatLngExpression = [lat, lng];
    if (this.previewDestinationMarker) {
      this.previewDestinationMarker.setLatLng(pos);
    } else {
      this.previewDestinationMarker = L.marker(pos, { icon: DESTINATION_ICON, opacity: 0.6 }).addTo(this.map);
    }
    this.map.setView(pos, 13);
  }

  private clearPendingDestinationPreview() {
    if (this.previewDestinationMarker) {
      this.map.removeLayer(this.previewDestinationMarker);
      this.previewDestinationMarker = null;
    }
    this.pendingDestination = null;
    this.destinationQuery = '';
  }

  toggleDestinationPlacement() {
    this.isPlacingDestination = !this.isPlacingDestination;
    if (this.isPlacingDestination) {
      this.isPlacingStop = false;
      this.toast.showToast({ type: 'info', message: 'Tap anywhere on the map to drop a pin' });
    }
  }

  startRide() {
    if (!this.pendingDestination) {
      this.toast.showToast({ type: 'error', message: 'Search or tap a destination first' });
      return;
    }
    // Broadcasts to everyone (including us) via DestinationSet — the hub
    // re-validates creator identity server-side from the JWT, so this
    // can't be spoofed even if the button were somehow clicked by a non-creator.
    this.signalR.setDestination(
      this.roomCode,
      this.pendingDestination.lat,
      this.pendingDestination.lng,
      this.pendingDestination.label,
    );
  }

  cancelPendingDestination() {
    this.clearPendingDestinationPreview();
  }

  // --- Anyone: propose/clear a stop (meeting point) ---

  toggleStopPlacement() {
    this.isPlacingStop = !this.isPlacingStop;
    if (this.isPlacingStop) {
      this.isPlacingDestination = false;
      this.toast.showToast({ type: 'info', message: 'Tap anywhere on the map to drop a meeting point' });
    }
  }

  private setPendingStop(lat: number, lng: number, label: string) {
    this.pendingStop = { lat, lng, label };

    const pos: L.LatLngExpression = [lat, lng];
    if (this.previewStopMarker) {
      this.previewStopMarker.setLatLng(pos);
    } else {
      this.previewStopMarker = L.marker(pos, { icon: STOP_ICON, opacity: 0.6 }).addTo(this.map);
    }
    this.map.setView(pos, 13);
  }

  private clearPendingStopPreview() {
    if (this.previewStopMarker) {
      this.map.removeLayer(this.previewStopMarker);
      this.previewStopMarker = null;
    }
    this.pendingStop = null;
  }

  confirmStop() {
    if (!this.pendingStop) {
      this.toast.showToast({ type: 'error', message: 'Tap a spot on the map first' });
      return;
    }
    this.signalR.addStop(this.roomCode, this.pendingStop.lat, this.pendingStop.lng, this.pendingStop.label);
  }

  cancelPendingStop() {
    this.clearPendingStopPreview();
  }

  // Any rider can clear the active stop once the group has regrouped there
  // — there's no creator-only restriction here by design, matching who's
  // allowed to add one in the first place.
  clearStop() {
    this.signalR.clearStop(this.roomCode);
  }

  // --- Anyone: share/stop sharing my live location ---

  toggleShareLocation() {
    if (this.isSharingLocation) {
      this.stopSharingLocation();
    } else {
      this.startSharingLocation();
    }
  }

  private startSharingLocation() {
    if (!navigator.geolocation) {
      this.toast.showToast({ type: 'error', message: 'Location not supported on this device' });
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePositionUpdate(pos),
      (err) => {
        console.warn('Geolocation error', err);
        this.toast.showToast({ type: 'error', message: 'Could not access location' });
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );

    this.isSharingLocation = true;
  }

  private stopSharingLocation() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.isSharingLocation) {
      this.signalR.stopSharingLocation(this.roomCode);
    }
    this.isSharingLocation = false;
    this.lastSentPos = null;
  }

  private handlePositionUpdate(pos: GeolocationPosition) {
    const { latitude: lat, longitude: lng } = pos.coords;
    const now = Date.now();

    let shouldSend = true;
    if (this.lastSentPos) {
      const distance = this.haversineMeters(this.lastSentPos.lat, this.lastSentPos.lng, lat, lng);
      const elapsed = now - this.lastSentAt;
      shouldSend = elapsed >= this.MIN_INTERVAL_MS || distance >= this.MIN_DISTANCE_M;
    }

    if (shouldSend) {
      this.lastSentAt = now;
      this.lastSentPos = { lat, lng };
      this.signalR.updateLocation(this.roomCode, this.userId, this.userName, lat, lng, this.myEtaMinutes);
    }

    // Keep my own route/ETA current as I move, independent of the
    // location-broadcast throttle above (routing recompute has its own,
    // looser threshold — see ROUTE_MIN_*).
    const target = this.getRouteTarget();
    if (target) {
      this.computeMyRoute(target, false);
    }
  }

  // Stop takes priority over destination — riders rally at the meeting
  // point first if one's active, then continue to the final destination
  // once it's cleared.
  private getRouteTarget(): DestinationPoint | null {
    return this.stop ?? this.destination;
  }

  private async computeMyRoute(target: DestinationPoint, force: boolean) {
    const myPos = await this.getMyCurrentPosition();
    if (!myPos) return;

    if (!force && this.lastRoutePos) {
      const distance = this.haversineMeters(this.lastRoutePos.lat, this.lastRoutePos.lng, myPos.lat, myPos.lng);
      const elapsed = Date.now() - this.lastRouteAt;
      if (elapsed < this.ROUTE_MIN_INTERVAL_MS && distance < this.ROUTE_MIN_DISTANCE_M) {
        return;
      }
    }

    try {
      const { coords, durationSeconds } = await this.fetchRoute(myPos.lat, myPos.lng, target.lat, target.lng);
      this.drawMyRoute(coords);
      this.myEtaMinutes = durationSeconds / 60;
      this.lastRouteAt = Date.now();
      this.lastRoutePos = myPos;

      // Push the fresh ETA out immediately rather than waiting for the
      // next GPS-driven location tick, so the tooltip others see updates
      // promptly right after a destination/stop change.
      this.signalR.updateLocation(this.roomCode, this.userId, this.userName, myPos.lat, myPos.lng, this.myEtaMinutes);
    } catch (err) {
      console.warn('Routing failed', err);
      if (force) {
        this.toast.showToast({ type: 'error', message: 'Could not calculate route to destination' });
      }
    }
  }

  private clearMyRoute() {
    if (this.myRouteLine) {
      this.map.removeLayer(this.myRouteLine);
      this.myRouteLine = null;
    }
    this.myEtaMinutes = null;
    if (this.lastSentPos) {
      this.signalR.updateLocation(this.roomCode, this.userId, this.userName, this.lastSentPos.lat, this.lastSentPos.lng, null);
    }
  }

  // Uses whatever we already know (live-sharing position) if available;
  // otherwise takes a single one-off GPS fix so routing works even for
  // riders who haven't turned on continuous location sharing.
  private getMyCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
    if (this.lastSentPos) return Promise.resolve(this.lastSentPos);

    if (!navigator.geolocation) return Promise.resolve(null);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => {
          console.warn('One-off geolocation fetch failed', err);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000 },
      );
    });
  }

  private async fetchRoute(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
  ): Promise<{ coords: L.LatLngExpression[]; durationSeconds: number }> {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM request failed: ${res.status}`);
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found');
    }

    // GeoJSON coordinates are [lng, lat] — Leaflet wants [lat, lng].
    const coordinates: [number, number][] = data.routes[0].geometry.coordinates;
    const coords = coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
    return { coords, durationSeconds: data.routes[0].duration };
  }

  private drawMyRoute(coords: L.LatLngExpression[]) {
    if (this.myRouteLine) {
      this.myRouteLine.setLatLngs(coords);
    } else {
      this.myRouteLine = L.polyline(coords, {
        color: '#ffb020', // var(--amber) — Leaflet doesn't read CSS vars directly
        weight: 5,
        opacity: 0.85,
      }).addTo(this.map);
    }
    this.map.fitBounds(this.myRouteLine.getBounds(), { padding: [40, 40] });
  }

  private haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
}
