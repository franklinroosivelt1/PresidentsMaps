import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cn } from '../lib/utils';
import { POI, MapLayer, RoutePoint } from '../types';
import * as turf from '@turf/turf';

interface MapViewProps {
  userLocation: { lat: number; lng: number } | null;
  pois: POI[];
  activeLayer: MapLayer;
  currentRoute: RoutePoint[];
  targetCenter?: { lat: number, lng: number };
  onCenterChange: (lat: number, lng: number) => void;
  onMapClick: (lat: number, lng: number) => void;
  onAddPOI: (poi: POI) => void;
  measurementMode: 'off' | 'straight' | 'path' | 'area';
  measurementPoints: { lat: number; lng: number }[];
  onAddMeasurementPoint: (lat: number, lng: number) => void;
}

const LAYER_CONFIGS: Record<MapLayer, string | any> = {
  'google-satellite': {
    version: 8,
    sources: {
      'google-satellite': {
        type: 'raster',
        tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
        tileSize: 256,
        attribution: 'Google'
      }
    },
    layers: [{ id: 'google-satellite', type: 'raster', source: 'google-satellite' }]
  },
  'google-hybrid': {
    version: 8,
    sources: {
      'google-hybrid': {
        type: 'raster',
        tiles: ['https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'],
        tileSize: 256,
        attribution: 'Google'
      }
    },
    layers: [{ id: 'google-hybrid', type: 'raster', source: 'google-hybrid' }]
  },
  'osm': {
    version: 8,
    sources: {
      'osm-tiles': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: 'OpenStreetMap'
      }
    },
    layers: [{ id: 'osm-layer', type: 'raster', source: 'osm-tiles' }]
  }
};

const MapView = ({ 
  userLocation,
  pois, 
  activeLayer, 
  currentRoute, 
  targetCenter,
  onCenterChange, 
  onMapClick, 
  measurementMode, 
  measurementPoints,
  onAddMeasurementPoint
}: MapViewProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [rotation, setRotation] = useState(0);
  const [distanceToCenter, setDistanceToCenter] = useState<number | null>(null);

  useEffect(() => {
    if (map.current && targetCenter) {
      map.current.flyTo({ center: [targetCenter.lng, targetCenter.lat], zoom: 15 });
    }
  }, [targetCenter]);

  useEffect(() => {
    if (!map.current || !userLocation) {
      setDistanceToCenter(null);
      return;
    }

    const center = map.current.getCenter();
    const from = turf.point([userLocation.lng, userLocation.lat]);
    const to = turf.point([center.lng, center.lat]);
    const dist = turf.distance(from, to, { units: 'meters' });
    
    setDistanceToCenter(dist > 5 ? dist : null);
  }, [userLocation, rotation]);

  useEffect(() => {
    if (!mapContainer.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: LAYER_CONFIGS[activeLayer],
      center: [-46.6333, -23.5505], // São Paulo
      zoom: 12,
      pitch: 0,
      bearing: 0,
      dragRotate: true,
      touchZoomRotate: true
    });

    map.current.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserLocation: true
    }), 'top-right');

    map.current.on('move', () => {
      if (map.current) {
        const center = map.current.getCenter();
        onCenterChange(center.lat, center.lng);
        setRotation(map.current.getBearing());

        if (userLocation) {
          const from = turf.point([userLocation.lng, userLocation.lat]);
          const to = turf.point([center.lng, center.lat]);
          const dist = turf.distance(from, to, { units: 'meters' });
          setDistanceToCenter(dist > 5 ? dist : null);
        }
      }
    });

    map.current.on('click', (e) => {
      if (measurementMode !== 'off') {
        onAddMeasurementPoint(e.lngLat.lat, e.lngLat.lng);
      } else {
        onMapClick(e.lngLat.lat, e.lngLat.lng);
      }
    });

    map.current.on('load', () => {
      if (!map.current) return;
      
      // Route line
      map.current.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        }
      });

      map.current.addLayer({
        id: 'route-layer',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#3b82f6', 'line-width': 4 }
      });

      // Measurement line
      map.current.addSource('measure', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        }
      });

      map.current.addLayer({
        id: 'measure-layer',
        type: 'line',
        source: 'measure',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ef4444', 'line-width': 2, 'line-dasharray': [2, 1] }
      });

      // Area source and layer
      map.current.addSource('area', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }
      });

      map.current.addLayer({
        id: 'area-layer',
        type: 'fill',
        source: 'area',
        paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.2 }
      });
      
      // KML source
      map.current.addSource('imported-kml', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current.addLayer({
        id: 'kml-layer',
        type: 'line',
        source: 'imported-kml',
        paint: { 'line-color': '#10b981', 'line-width': 2 }
      });
    });

    return () => map.current?.remove();
  }, []);

  useEffect(() => {
    if (!map.current) return;
    map.current.setStyle(LAYER_CONFIGS[activeLayer]);
  }, [activeLayer]);

  useEffect(() => {
    if (!map.current) return;

    // Clear old markers
    markers.current.forEach(m => m.remove());
    markers.current = [];

    // Add new markers
    pois.forEach(poi => {
      const el = document.createElement('div');
      el.className = 'marker';
      el.style.backgroundColor = poi.color;
      el.style.width = '12px';
      el.style.height = '12px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 0 5px rgba(0,0,0,0.3)';

      const marker = new maplibregl.Marker(el)
        .setLngLat([poi.lng, poi.lat])
        .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`<h3>${poi.name}</h3><p>${poi.description}</p>`))
        .addTo(map.current!);
      
      markers.current.push(marker);
    });
  }, [pois]);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const source = map.current.getSource('route') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: currentRoute.map(p => [p.lng, p.lat])
        }
      });
    }
  }, [currentRoute]);

  useEffect(() => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const lineSource = map.current.getSource('measure') as maplibregl.GeoJSONSource;
    const areaSource = map.current.getSource('area') as maplibregl.GeoJSONSource;
    
    if (lineSource) {
      lineSource.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: measurementPoints.map(p => [p.lng, p.lat])
        }
      });
    }

    if (areaSource && measurementPoints.length > 2) {
      areaSource.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[...measurementPoints, measurementPoints[0]].map(p => [p.lng, p.lat])]
        }
      });
    } else if (areaSource) {
      areaSource.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: []
        }
      });
    }
  }, [measurementPoints]);

  return (
    <div ref={mapContainer} className="map-container relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10 print:hidden">
        <div className="w-4 h-4 border-2 border-white rounded-full flex items-center justify-center shadow-lg relative">
          <div className="w-1 h-1 bg-white rounded-full" />
          
          {distanceToCenter && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
              <div className="bg-zinc-900/90 backdrop-blur-md border border-zinc-800 px-2 py-1 rounded-full shadow-2xl flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-blue-500" />
                <span className="text-[10px] font-bold text-white font-mono">
                  {distanceToCenter < 1000 
                    ? `${distanceToCenter.toFixed(0)}m` 
                    : `${(distanceToCenter / 1000).toFixed(2)}km`}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* SVG for Distance Line from User to Cursor */}
      {distanceToCenter && userLocation && map.current && (
         <svg className="absolute inset-0 pointer-events-none z-[5]" style={{ width: '100%', height: '100%' }}>
            {(() => {
              const userPos = map.current.project([userLocation.lng, userLocation.lat]);
              const centerPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
              return (
                <>
                  <line 
                    x1={userPos.x} y1={userPos.y} 
                    x2={centerPos.x} y2={centerPos.y} 
                    stroke="#3b82f6" 
                    strokeWidth="2" 
                    strokeDasharray="4,2"
                    opacity="0.6"
                  />
                  <circle cx={userPos.x} cy={userPos.y} r="4" fill="#3b82f6" />
                </>
              );
            })()}
         </svg>
      )}
    </div>
  );
};

export default MapView;
