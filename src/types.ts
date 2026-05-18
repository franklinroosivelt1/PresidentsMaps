export interface POI {
  id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  color: string;
  createdAt: number;
  visible?: boolean;
}

export interface ImportedKML {
  id: string;
  name: string;
  visible: boolean;
  data: any; // GeoJSON
}

export interface RoutePoint {
  lat: number;
  lng: number;
  timestamp: number;
}

export interface SavedRoute {
  id: string;
  name: string;
  points: RoutePoint[];
  distance: number;
  createdAt: number;
}

export type MapLayer = 'google-satellite' | 'google-hybrid' | 'osm';

export interface AppState {
  pois: POI[];
  routes: SavedRoute[];
  importedKmls: ImportedKML[];
  activeLayer: MapLayer;
  isRecording: boolean;
  currentRoute: RoutePoint[];
  measurementMode: 'off' | 'straight' | 'path' | 'area';
  measurementPoints: { lat: number; lng: number }[];
  coordinateFormat: 'DMS' | 'UTM';
  distanceUnit: 'mt' | 'km';
  overlayUrl?: string;
  overlayBounds?: [[number, number], [number, number]];
}
