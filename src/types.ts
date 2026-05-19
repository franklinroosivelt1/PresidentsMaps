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

export interface ImportedMap {
  id: string;
  name: string;
  url: string; 
  bounds: [[number, number], [number, number]]; // [sw, ne]
  visible: boolean;
}

export type MapLayer = 'google-satellite' | 'google-hybrid' | 'osm';

export interface AppState {
  pois: POI[];
  routes: SavedRoute[];
  importedKmls: ImportedKML[];
  importedMaps: ImportedMap[];
  activeLayer: MapLayer;
  isRecording: boolean;
  currentRoute: RoutePoint[];
  measurementMode: 'off' | 'straight' | 'path' | 'area';
  measurementPoints: { lat: number; lng: number }[];
  coordinateFormat: 'DMS' | 'UTM';
  distanceUnit: 'mt' | 'km';
  lastCenter?: { lat: number; lng: number };
}
