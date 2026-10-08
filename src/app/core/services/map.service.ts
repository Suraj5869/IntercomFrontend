import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';

export interface MapSearchResult {
  label: string;
  featureType: string;
  lat: number;
  lng: number;
}

export interface MapCoordinate {
  lat: number;
  lng: number;
}

export interface MapTrafficSegment {
  coordinates: MapCoordinate[];
  level: 'unknown' | 'low' | 'moderate' | 'heavy' | 'severe';
  numeric: number | null;
}

export interface MapRouteStep {
  distance: number;
  name: string;
  maneuverType: string;
  modifier?: string | null;
  maneuverLocation: MapCoordinate;
}

export interface MapRouteResponse {
  coordinates: MapCoordinate[];
  trafficSegments: MapTrafficSegment[];
  steps: MapRouteStep[];
  durationSeconds: number;
  typicalDurationSeconds: number;
  trafficDelaySeconds: number;
  distanceMeters: number;
  trafficLevel: 'unknown' | 'low' | 'moderate' | 'heavy' | 'severe';
  trafficDataAvailable: boolean;
}

@Injectable({ providedIn: 'root' })
export class MapService {
  private readonly baseUrl = `${environment.apiUrl}/Map`;

  constructor(private readonly http: HttpClient) {}

  search(
    query: string,
    proximity?: { lat: number; lng: number } | null,
  ): Observable<MapSearchResult[]> {
    let params = new HttpParams().set('q', query);

    if (proximity) {
      params = params
        .set('lat', proximity.lat.toString())
        .set('lng', proximity.lng.toString());
    }

    return this.http.get<MapSearchResult[]>(`${this.baseUrl}/search`, {
      params,
    });
  }

  route(
    from: MapCoordinate,
    to: MapCoordinate,
    travelMode: 'car' | 'bike' = 'car',
  ): Observable<MapRouteResponse> {
    const params = new HttpParams()
      .set('fromLat', from.lat.toString())
      .set('fromLng', from.lng.toString())
      .set('toLat', to.lat.toString())
      .set('toLng', to.lng.toString())
      .set('travelMode', travelMode);

    return this.http.get<MapRouteResponse>(`${this.baseUrl}/route`, {
      params,
    });
  }
}
