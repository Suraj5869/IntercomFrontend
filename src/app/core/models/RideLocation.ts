export interface RiderLocation {

  connectionId: string;

  userId: string;

  userName: string;

  lat: number;

  lng: number;

  etaMinutes: number | null;

  travelMode: 'car' | 'bike' | null;

  updatedAt: string;
}
