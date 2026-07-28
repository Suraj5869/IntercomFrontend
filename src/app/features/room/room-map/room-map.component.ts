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
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const DESTINATION_ICON = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
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
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [28, 46],
  iconAnchor: [14, 46],
  popupAnchor: [1, -38],
  shadowSize: [46, 46],
  className: 'stop-marker-icon',
});

// Fixed palette, hashed off userId so every client colours the same rider
// identically. Must be userId, not connectionId — that changes on reconnect.
const RIDER_COLORS = [
  '#e6482e',
  '#1e88e5',
  '#00897b',
  '#8e24aa',
  '#d81b60',
  '#43a047',
  '#5e35b1',
  '#00acc1',
];

function riderColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++)
    h = (h * 31 + userId.charCodeAt(i)) | 0;
  return RIDER_COLORS[Math.abs(h) % RIDER_COLORS.length];
}

interface OsrmStep {
  distance: number;
  name: string;
  maneuver: { type: string; modifier?: string; location: [number, number] };
}

interface NavStep {
  icon: string;
  instruction: string;
  roadName: string;
  atMeters: number; // cumulative distance along the route
}

export type TravelMode = 'car' | 'bike';

const TRAVEL_MODES: Record<
  TravelMode,
  {
    label: string;
    icon: string;
    profile: string;
    etaFactor: number;
    color: string;
  }
> = {
  car: {
    label: 'Car',
    icon: '🚗',
    profile: 'routed-car',
    etaFactor: 1,
    color: '#ffb020',
  },
  // Motorcycle shares the car road network; only the ETA differs meaningfully.
  // For an actual bicycle: profile 'routed-bike', etaFactor 1.
  bike: {
    label: 'Bike',
    icon: '🏍️',
    profile: 'routed-car',
    etaFactor: 0.85,
    color: '#4ea8de',
  },
};

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
  travelMode: TravelMode =
    (localStorage.getItem('travelMode') as TravelMode) || 'car';
  travelModeOptions = (Object.keys(TRAVEL_MODES) as TravelMode[]).map(
    (key) => ({ key, ...TRAVEL_MODES[key] }),
  );

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
  // was: private myEtaMinutes
  myEtaMinutes: number | null = null;

  private routeCoords: L.LatLng[] = [];
  private routeCum: number[] = [];
  private routeSteps: NavStep[] = [];
  private navTotalMeters = 0;
  private progressIndex = 0;

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

  get navRemainingMeters(): number {
    return Math.max(
      0,
      this.navTotalMeters - (this.routeCum[this.progressIndex] ?? 0),
    );
  }

  get navNextStep(): NavStep | null {
    const done = this.routeCum[this.progressIndex] ?? 0;
    return this.routeSteps.find((s) => s.atMeters > done + 10) ?? null;
  }

  get navDistanceToNext(): number {
    const step = this.navNextStep;
    return step
      ? Math.max(0, step.atMeters - (this.routeCum[this.progressIndex] ?? 0))
      : 0;
  }

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

  // private renderRider(location: RiderLocation) {
  //   const pos: L.LatLngExpression = [location.lat, location.lng];
  //   const existing = this.riderMarkers.get(location.connectionId);
  //   const etaText = this.formatEtaTooltip(location);

  //   if (existing) {
  //     existing.setLatLng(pos);
  //     existing.setPopupContent(this.riderPopupText(location));
  //     this.applyEtaTooltip(existing, etaText);
  //   } else {
  //     const marker = L.marker(pos, { icon: DEFAULT_ICON })
  //       .addTo(this.map)
  //       .bindPopup(this.riderPopupText(location));
  //     this.applyEtaTooltip(marker, etaText);
  //     this.riderMarkers.set(location.connectionId, marker);
  //   }
  // }

  private renderRider(location: RiderLocation) {
    const pos: L.LatLngExpression = [location.lat, location.lng];
    const existing = this.riderMarkers.get(location.connectionId);

    if (existing) {
      existing.setLatLng(pos);
      existing.setIcon(this.riderIcon(location));
    } else {
      const marker = L.marker(pos, {
        icon: this.riderIcon(location),
        zIndexOffset: location.userId === this.userId ? 1000 : 0,
      }).addTo(this.map);
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

  // private formatEtaTooltip(location: RiderLocation): string | null {
  //   if (location.etaMinutes == null) return null;
  //   const mins = Math.round(location.etaMinutes);
  //   return mins < 1 ? 'Arriving' : `${mins} min`;
  // }

  //   private formatEtaTooltip(location: RiderLocation): string | null {
  //   if (location.etaMinutes == null) return null;
  //   const icon = location.travelMode ? TRAVEL_MODES[location.travelMode].icon : '';
  //   const mins = Math.round(location.etaMinutes);
  //   return `${icon} ${mins < 1 ? 'Arriving' : `${mins} min`}`.trim();
  // }

  formatEta(minutes: number | null | undefined): string | null {
    if (minutes == null) return null;
    const total = Math.round(minutes);
    if (total < 1) return 'Arriving';
    if (total < 60) return `${total} min`;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
  }

  formatDistance(meters: number): string {
    return meters < 1000
      ? `${Math.round(meters)} m`
      : `${(meters / 1000).toFixed(1)} km`;
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
    this.searchDebounceTimer = setTimeout(
      () => this.searchNominatim(value),
      450,
    );
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
      this.toast.showToast({
        type: 'error',
        message: 'Address search failed — try again',
      });
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
      this.previewDestinationMarker = L.marker(pos, {
        icon: DESTINATION_ICON,
        opacity: 0.6,
      }).addTo(this.map);
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
      this.toast.showToast({
        type: 'info',
        message: 'Tap anywhere on the map to drop a pin',
      });
    }
  }

  startRide() {
    if (!this.pendingDestination) {
      this.toast.showToast({
        type: 'error',
        message: 'Search or tap a destination first',
      });
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
      this.toast.showToast({
        type: 'info',
        message: 'Tap anywhere on the map to drop a meeting point',
      });
    }
  }

  private setPendingStop(lat: number, lng: number, label: string) {
    this.pendingStop = { lat, lng, label };

    const pos: L.LatLngExpression = [lat, lng];
    if (this.previewStopMarker) {
      this.previewStopMarker.setLatLng(pos);
    } else {
      this.previewStopMarker = L.marker(pos, {
        icon: STOP_ICON,
        opacity: 0.6,
      }).addTo(this.map);
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
      this.toast.showToast({
        type: 'error',
        message: 'Tap a spot on the map first',
      });
      return;
    }
    this.signalR.addStop(
      this.roomCode,
      this.pendingStop.lat,
      this.pendingStop.lng,
      this.pendingStop.label,
    );
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

  setTravelMode(mode: TravelMode) {
    if (mode === this.travelMode) return;
    this.travelMode = mode;
    localStorage.setItem('travelMode', mode);

    const target = this.getRouteTarget();
    if (target) {
      this.computeMyRoute(target, true);
    } else if (this.lastSentPos) {
      // No target yet — still tell the room which vehicle I'm on.
      this.signalR.updateLocation(
        this.roomCode,
        this.userId,
        this.userName,
        this.lastSentPos.lat,
        this.lastSentPos.lng,
        this.myEtaMinutes,
        this.travelMode,
      );
    }
  }

  private startSharingLocation() {
    if (!navigator.geolocation) {
      this.toast.showToast({
        type: 'error',
        message: 'Location not supported on this device',
      });
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePositionUpdate(pos),
      (err) => {
        console.warn('Geolocation error', err);
        this.toast.showToast({
          type: 'error',
          message: 'Could not access location',
        });
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
      const distance = this.haversineMeters(
        this.lastSentPos.lat,
        this.lastSentPos.lng,
        lat,
        lng,
      );
      const elapsed = now - this.lastSentAt;
      shouldSend =
        elapsed >= this.MIN_INTERVAL_MS || distance >= this.MIN_DISTANCE_M;
    }

    if (shouldSend) {
      this.lastSentAt = now;
      this.lastSentPos = { lat, lng };
      this.signalR.updateLocation(
        this.roomCode,
        this.userId,
        this.userName,
        lat,
        lng,
        this.myEtaMinutes,
        this.travelMode,
      );
    }

    if (this.routeCoords.length) {
      this.updateProgress(L.latLng(lat, lng));
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
      const distance = this.haversineMeters(
        this.lastRoutePos.lat,
        this.lastRoutePos.lng,
        myPos.lat,
        myPos.lng,
      );
      const elapsed = Date.now() - this.lastRouteAt;
      if (
        elapsed < this.ROUTE_MIN_INTERVAL_MS &&
        distance < this.ROUTE_MIN_DISTANCE_M
      ) {
        return;
      }
    }

    try {
      const { coords, durationSeconds, distanceMeters, steps } =
        await this.fetchRoute(
          myPos.lat,
          myPos.lng,
          target.lat,
          target.lng,
          this.travelMode,
        );
      this.drawMyRoute(coords);
      this.buildNavigation(coords, distanceMeters, steps);
      this.updateProgress(L.latLng(myPos.lat, myPos.lng));
      this.myEtaMinutes = durationSeconds / 60;
      this.lastRouteAt = Date.now();
      this.lastRoutePos = myPos;

      this.signalR.updateLocation(
        this.roomCode,
        this.userId,
        this.userName,
        myPos.lat,
        myPos.lng,
        this.myEtaMinutes,
        this.travelMode,
      );
    } catch (err) {
      console.warn('Routing failed', err);
      if (force) {
        this.toast.showToast({
          type: 'error',
          message: 'Could not calculate route to destination',
        });
      }
    }
  }

  private buildNavigation(
    coords: L.LatLngExpression[],
    distanceMeters: number,
    steps: OsrmStep[],
  ) {
    this.routeCoords = coords.map((c) => L.latLng(c as [number, number]));
    this.routeCum = [0];
    for (let i = 1; i < this.routeCoords.length; i++) {
      this.routeCum[i] =
        this.routeCum[i - 1] +
        this.routeCoords[i - 1].distanceTo(this.routeCoords[i]);
    }
    this.navTotalMeters =
      this.routeCum[this.routeCum.length - 1] || distanceMeters;
    this.progressIndex = 0;

    this.routeSteps = steps.map((s) => {
      const [lng, lat] = s.maneuver.location;
      return {
        ...this.maneuverText(s),
        roadName: s.name || '',
        atMeters: this.routeCum[this.globalNearestIndex(L.latLng(lat, lng))],
      };
    });
  }

  // Forward-biased search. A global nearest-vertex scan looks correct until the
  // route passes near itself — common in cities — at which point it snaps
  // backwards and the remaining distance jumps. Only fall back to a global
  // search when we're clearly off the tracked segment.
  private updateProgress(pos: L.LatLng) {
    const from = this.progressIndex;
    const to = Math.min(this.routeCoords.length - 1, from + 400);
    let best = from,
      bestD = Infinity;

    for (let i = from; i <= to; i++) {
      const d = this.routeCoords[i].distanceTo(pos);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > 150) best = this.globalNearestIndex(pos);

    this.progressIndex = best;
  }

  private globalNearestIndex(p: L.LatLng): number {
    let best = 0,
      bestD = Infinity;
    for (let i = 0; i < this.routeCoords.length; i++) {
      const d = this.routeCoords[i].distanceTo(p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private maneuverText(s: OsrmStep): { icon: string; instruction: string } {
    const t = s.maneuver.type;
    const m = s.maneuver.modifier;
    if (t === 'depart') return { icon: '↑', instruction: 'Head out' };
    if (t === 'arrive')
      return { icon: '◎', instruction: 'Arrive at destination' };
    if (t === 'roundabout' || t === 'rotary')
      return { icon: '↻', instruction: 'Take the roundabout' };
    if (t === 'merge') return { icon: '⤳', instruction: 'Merge' };
    if (t === 'fork')
      return { icon: '⋔', instruction: m ? `Keep ${m}` : 'Keep going' };
    if (m === 'uturn') return { icon: '↩', instruction: 'Make a U-turn' };
    if (m === 'left' || m === 'slight left' || m === 'sharp left')
      return { icon: '←', instruction: `Turn ${m}` };
    if (m === 'right' || m === 'slight right' || m === 'sharp right')
      return { icon: '→', instruction: `Turn ${m}` };
    return { icon: '↑', instruction: 'Continue' };
  }

  private clearMyRoute() {
    this.routeCoords = [];
    this.routeCum = [];
    this.routeSteps = [];
    this.navTotalMeters = 0;
    this.progressIndex = 0;
    if (this.myRouteLine) {
      this.map.removeLayer(this.myRouteLine);
      this.myRouteLine = null;
    }
    this.myEtaMinutes = null;
    if (this.lastSentPos) {
      this.signalR.updateLocation(
        this.roomCode,
        this.userId,
        this.userName,
        this.lastSentPos.lat,
        this.lastSentPos.lng,
        null,
        this.travelMode,
      );
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
        (pos) =>
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
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
    mode: TravelMode,
  ): Promise<{
    coords: L.LatLngExpression[];
    durationSeconds: number;
    distanceMeters: number;
    steps: OsrmStep[];
  }> {
    const cfg = TRAVEL_MODES[mode];
    const url =
      `https://routing.openstreetmap.de/${cfg.profile}/route/v1/driving/` +
      `${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM request failed: ${res.status}`);
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found');
    }

    // GeoJSON coordinates are [lng, lat] — Leaflet wants [lat, lng].
    const coordinates: [number, number][] = data.routes[0].geometry.coordinates;
    const coords = coordinates.map(
      ([lng, lat]) => [lat, lng] as L.LatLngExpression,
    );
    return {
      coords,
      durationSeconds: data.routes[0].duration,
      distanceMeters: data.routes[0].distance,
      steps: data.routes[0].legs.flatMap((l: any) => l.steps) as OsrmStep[],
    };
  }

  // private async fetchRoute(
  //   fromLat: number,
  //   fromLng: number,
  //   toLat: number,
  //   toLng: number,
  // ): Promise<{ coords: L.LatLngExpression[]; durationSeconds: number }> {
  //   const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
  //   const res = await fetch(url);
  //   if (!res.ok) throw new Error(`OSRM request failed: ${res.status}`);
  //   const data = await res.json();

  //   if (!data.routes || data.routes.length === 0) {
  //     throw new Error('No route found');
  //   }

  //   // GeoJSON coordinates are [lng, lat] — Leaflet wants [lat, lng].
  //   const coordinates: [number, number][] = data.routes[0].geometry.coordinates;
  //   const coords = coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngExpression);
  //   return { coords, durationSeconds: data.routes[0].duration };
  // }

  // private drawMyRoute(coords: L.LatLngExpression[]) {
  //   if (this.myRouteLine) {
  //     this.myRouteLine.setLatLngs(coords);
  //   } else {
  //     this.myRouteLine = L.polyline(coords, {
  //       color: '#ffb020', // var(--amber) — Leaflet doesn't read CSS vars directly
  //       weight: 5,
  //       opacity: 0.85,
  //     }).addTo(this.map);
  //   }
  //   this.map.fitBounds(this.myRouteLine.getBounds(), { padding: [40, 40] });
  // }

  private drawMyRoute(coords: L.LatLngExpression[]) {
    const color = TRAVEL_MODES[this.travelMode].color;
    if (this.myRouteLine) {
      this.myRouteLine.setLatLngs(coords);
      this.myRouteLine.setStyle({ color });
    } else {
      this.myRouteLine = L.polyline(coords, {
        color,
        weight: 5,
        opacity: 0.85,
      })
        .addTo(this.map)
        .bindTooltip(
          () => `${this.formatDistance(this.navRemainingMeters)} remaining`,
          { sticky: true, className: 'route-tooltip' },
        );
    }
    this.map.fitBounds(this.myRouteLine.getBounds(), { padding: [40, 40] });
  }

  private haversineMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  private riderIcon(location: RiderLocation): L.DivIcon {
    const isMe = location.userId === this.userId;
    const color = isMe ? '#ffb020' : riderColor(location.userId);
    const name = isMe ? 'You' : location.userName;
    const eta = this.formatEta(location.etaMinutes);

    return L.divIcon({
      className: 'rider-node',
      html:
        `<span class="rider-pin" style="background:${color}"></span>` +
        `<span class="rider-label" style="border-color:${color}">` +
        `<b>${this.escapeHtml(name)}</b>` +
        (eta ? `<i>${eta}</i>` : '') +
        `</span>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  // userName arrives over SignalR from another user, so it is untrusted input
  // going into innerHTML. Escape it or you have stored XSS in the room.
  private escapeHtml(s: string): string {
    return (s ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c]!,
    );
  }
}
