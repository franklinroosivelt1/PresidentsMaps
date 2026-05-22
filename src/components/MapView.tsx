import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cn } from '../lib/utils';
import { POI, MapLayer, RoutePoint, ImportedMap } from '../types';
import * as turf from '@turf/turf';
import { decimalToDMS, latLngToUTM } from '../lib/coordinates';

interface MapViewProps {
  userLocation: { lat: number; lng: number } | null;
  pois: POI[];
  importedMaps: ImportedMap[];
  activeLayer: MapLayer;
  currentRoute: RoutePoint[];
  targetCenter?: { lat: number, lng: number, timestamp: number } | null;
  onCenterChange: (lat: number, lng: number) => void;
  onMapClick: (lat: number, lng: number) => void;
  onAddPOI: (poi: POI) => void;
  measurementMode: 'off' | 'straight' | 'path' | 'area';
  measurementPoints: { lat: number; lng: number }[];
  onAddMeasurementPoint: (lat: number, lng: number) => void;
  activeAddPoint?: boolean;
  tempPoint?: { lat: number; lng: number } | null;
  appState?: any;
}

const LAYER_CONFIGS: Record<MapLayer, any> = {
  'google-satellite': {
    version: 8,
    sources: {
      'google-satellite': {
        type: 'raster',
        tiles: [
          'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
          'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
          'https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
          'https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
        ],
        tileSize: 256,
        attribution: 'Google'
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#000000' } },
      { id: 'google-satellite', type: 'raster', source: 'google-satellite' }
    ]
  },
  'google-hybrid': {
    version: 8,
    sources: {
      'google-hybrid': {
        type: 'raster',
        tiles: [
          'https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
          'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
          'https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
          'https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'
        ],
        tileSize: 256,
        attribution: 'Google'
      }
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#000000' } },
      { id: 'google-hybrid', type: 'raster', source: 'google-hybrid' }
    ]
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
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#000000' } },
      { id: 'osm-layer', type: 'raster', source: 'osm-tiles' }
    ]
  }
};

const MapView = ({ 
  userLocation,
  pois, 
  importedMaps,
  activeLayer, 
  currentRoute, 
  targetCenter,
  onCenterChange, 
  onMapClick, 
  measurementMode, 
  measurementPoints,
  onAddMeasurementPoint,
  activeAddPoint,
  tempPoint,
  appState
}: MapViewProps) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const markersMap = useRef<Record<string, maplibregl.Marker>>({});
  const measurementMarkers = useRef<maplibregl.Marker[]>([]);
  const [rotation, setRotation] = useState(0);
  const [distanceToCenter, setDistanceToCenter] = useState<number | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const userLocationMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Use callback ref to avoid stale closures in map event handlers
  const callbackRefs = useRef({
    onMapClick,
    onAddMeasurementPoint,
    measurementMode,
    activeAddPoint
  });

  useEffect(() => {
    callbackRefs.current = {
      onMapClick,
      onAddMeasurementPoint,
      measurementMode,
      activeAddPoint
    };
  }, [onMapClick, onAddMeasurementPoint, measurementMode, activeAddPoint]);

  useEffect(() => {
    if (map.current && targetCenter) {
      map.current.flyTo({ 
        center: [targetCenter.lng, targetCenter.lat], 
        zoom: 15,
        essential: true 
      });

      // Find if there is a POI near targetCenter and open its popup
      setTimeout(() => {
        if (!map.current) return;
        const matchingPoi = pois.find(p => 
          Math.abs(p.lat - targetCenter.lat) < 0.0001 && 
          Math.abs(p.lng - targetCenter.lng) < 0.0001
        );
        if (matchingPoi) {
          const marker = markersMap.current[matchingPoi.id];
          if (marker) {
            // Close any open popups first
            Object.keys(markersMap.current).forEach(key => {
              const m = markersMap.current[key];
              if (m && m.getPopup().isOpen()) m.togglePopup();
            });
            if (!marker.getPopup().isOpen()) {
              marker.togglePopup();
            }
          }
        }
      }, 600); // Wait for flyTo transition to begin or complete
    }
  }, [targetCenter?.timestamp, pois]);

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

    let initCenter: [number, number] = [-46.6333, -23.5505];
    let initZoom = 12;

    const saved = localStorage.getItem('president_maps_v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.lastCenter && parsed.lastCenter.lat !== undefined && parsed.lastCenter.lng !== undefined) {
          const lat = Number(parsed.lastCenter.lat);
          const lng = Number(parsed.lastCenter.lng);
          if (!isNaN(lat) && !isNaN(lng)) {
            initCenter = [lng, lat];
          }
        }
        if (parsed.lastZoom !== undefined) {
          const zoom = Number(parsed.lastZoom);
          if (!isNaN(zoom)) {
            initZoom = zoom;
          }
        }
      } catch (e) {}
    }

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: LAYER_CONFIGS[activeLayer],
      center: initCenter,
      zoom: initZoom,
      pitch: 0,
      bearing: 0,
      dragRotate: true,
      touchZoomRotate: true,
      dragPan: true,
      scrollZoom: true,
      touchPitch: true,
      doubleClickZoom: true
    });

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
      const { measurementMode: currentMode, onAddMeasurementPoint: clickMeasure, onMapClick: clickMap } = callbackRefs.current;
      if (currentMode !== 'off') {
        clickMeasure(e.lngLat.lat, e.lngLat.lng);
      } else {
        clickMap(e.lngLat.lat, e.lngLat.lng);
      }
    });

    const onStyleLoad = () => {
      if (!map.current) return;
      setStyleLoaded(true);
      
      // Imported Maps Source Handling
      importedMaps.forEach(m => {
        if (!map.current?.getSource(`map-${m.id}`) && m.visible) {
          const sw = m.bounds[0];
          const ne = m.bounds[1];
          const coords = m.coordinates || [
            [sw[1], ne[0]], // tl
            [ne[1], ne[0]], // tr
            [ne[1], sw[0]], // br
            [sw[1], sw[0]]  // bl
          ];
          
          // Validate coordinates to prevent map display collapse / WebGL crash on NaN or out-of-bounds values
          const isValid = coords && coords.every((pt: any) => 
            Array.isArray(pt) && 
            pt.length === 2 && 
            typeof pt[0] === 'number' && !isNaN(pt[0]) && isFinite(pt[0]) && pt[0] >= -180 && pt[0] <= 180 &&
            typeof pt[1] === 'number' && !isNaN(pt[1]) && isFinite(pt[1]) && pt[1] >= -90 && pt[1] <= 90
          );

          if (!isValid) {
            console.error(`Ignoring map overlay map-${m.id} due to invalid/corrupt coordinates:`, coords);
            return;
          }

          map.current?.addSource(`map-${m.id}`, {
            type: 'image',
            url: m.url,
            coordinates: coords
          });
          map.current?.addLayer({
            id: `map-layer-${m.id}`,
            type: 'raster',
            source: `map-${m.id}`,
            paint: { 'raster-opacity': 1.0 }
          });
        }
      });
      if (!map.current.getSource('route')) {
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
      }

      if (!map.current.getSource('selected-route')) {
        map.current.addSource('selected-route', {
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
          id: 'selected-route-layer',
          type: 'line',
          source: 'selected-route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#d946ef', 'line-width': 6 }
        });
      }

      // Measurement line
      if (!map.current.getSource('measure')) {
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
          paint: { 'line-color': '#facc15', 'line-width': 3.5, 'line-dasharray': [2, 1] }
        });
      }

      // Area source and layer
      if (!map.current.getSource('area')) {
        map.current.addSource('area', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [] } }
        });

        map.current.addLayer({
          id: 'area-layer',
          type: 'fill',
          source: 'area',
          paint: { 'fill-color': '#facc15', 'fill-opacity': 0.25 }
        });
      }
      
      // KML source
      if (!map.current.getSource('imported-kml')) {
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
      }
    };

    map.current.on('style.load', onStyleLoad);

    const resizeObserver = new ResizeObserver(() => {
      map.current?.resize();
    });
    if (mapContainer.current) {
      resizeObserver.observe(mapContainer.current);
    }

    return () => {
      resizeObserver.disconnect();
      map.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!map.current || !styleLoaded) return;

    // Manage visibility of imported maps
    importedMaps.forEach(m => {
      const sourceId = `map-${m.id}`;
      const layerId = `map-layer-${m.id}`;

      if (m.visible) {
        if (!map.current?.getSource(sourceId)) {
          const sw = m.bounds[0];
          const ne = m.bounds[1];
          const coords = m.coordinates || [
            [sw[1], ne[0]], // tl
            [ne[1], ne[0]], // tr
            [ne[1], sw[0]], // br
            [sw[1], sw[0]]  // bl
          ];

          // Validate coordinates to prevent map display collapse / WebGL crash on NaN or out-of-bounds values
          const isValid = coords && coords.every((pt: any) => 
            Array.isArray(pt) && 
            pt.length === 2 && 
            typeof pt[0] === 'number' && !isNaN(pt[0]) && isFinite(pt[0]) && pt[0] >= -180 && pt[0] <= 180 &&
            typeof pt[1] === 'number' && !isNaN(pt[1]) && isFinite(pt[1]) && pt[1] >= -90 && pt[1] <= 90
          );

          if (!isValid) {
            console.error(`Ignoring map overlay map-${m.id} due to invalid/corrupt coordinates during reactive refresh:`, coords);
            return;
          }

          map.current?.addSource(sourceId, {
            type: 'image',
            url: m.url,
            coordinates: coords
          });
          map.current?.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            paint: { 'raster-opacity': 1.0 }
          });
        } else {
          map.current?.setLayoutProperty(layerId, 'visibility', 'visible');
        }
      } else {
        if (map.current?.getLayer(layerId)) {
          map.current?.setLayoutProperty(layerId, 'visibility', 'none');
        }
      }
    });

    // Remove deleted maps
    const existingLayerIds = map.current.getStyle().layers?.filter(l => l.id.startsWith('map-layer-')).map(l => l.id.replace('map-layer-', '')) || [];
    existingLayerIds.forEach(id => {
      if (!importedMaps.find(m => m.id === id)) {
        if (map.current?.getLayer(`map-layer-${id}`)) map.current.removeLayer(`map-layer-${id}`);
        if (map.current?.getSource(`map-${id}`)) map.current.removeSource(`map-${id}`);
      }
    });

  }, [importedMaps, styleLoaded]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (!map.current || isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setStyleLoaded(false);
    map.current.setStyle(LAYER_CONFIGS[activeLayer]);
  }, [activeLayer]);

  const tempMarkerRef = useRef<maplibregl.Marker | null>(null);

  // Manage temporary pin ("Alfinete")
  useEffect(() => {
    if (tempMarkerRef.current) {
      tempMarkerRef.current.remove();
      tempMarkerRef.current = null;
    }

    if (!map.current || !tempPoint) return;

    const el = document.createElement('div');
    el.className = 'temp-marker cursor-grab active:cursor-grabbing';
    el.innerHTML = `
      <div class="relative flex items-center justify-center">
        <div class="absolute w-7 h-7 bg-emerald-500 rounded-full opacity-40 animate-ping"></div>
        <div class="w-5 h-5 bg-emerald-600 rounded-full border-2 border-white shadow-2xl flex items-center justify-center">
          <div class="w-2 h-2 bg-white rounded-full"></div>
        </div>
      </div>
    `;

    tempMarkerRef.current = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([tempPoint.lng, tempPoint.lat])
      .addTo(map.current);

    tempMarkerRef.current.on('dragend', () => {
      if (tempMarkerRef.current) {
        const lngLat = tempMarkerRef.current.getLngLat();
        callbackRefs.current.onMapClick(lngLat.lat, lngLat.lng);
      }
    });
  }, [tempPoint]);

  useEffect(() => {
    if (!map.current || !styleLoaded) return;

    // Clear old markers
    markers.current.forEach(m => m.remove());
    markers.current = [];
    markersMap.current = {};

    // Add new markers & manage lines/polygons
    pois.forEach(poi => {
      if (poi.visible === false) {
        // Hide its layers if they exist
        const fillLayerId = `poi-fill-${poi.id}`;
        const lineLayerId = `poi-line-${poi.id}`;
        if (map.current?.getLayer(fillLayerId)) map.current.setLayoutProperty(fillLayerId, 'visibility', 'none');
        if (map.current?.getLayer(lineLayerId)) map.current.setLayoutProperty(lineLayerId, 'visibility', 'none');
        return;
      }

      // Check if this POI is an Area or Path to register its GeoJSON layers
      if ((poi.type === 'area' || poi.type === 'path') && poi.pathPoints && poi.pathPoints.length > 0) {
        const sourceId = `poi-source-${poi.id}`;
        const fillLayerId = `poi-fill-${poi.id}`;
        const lineLayerId = `poi-line-${poi.id}`;
        const coords = poi.pathPoints.map(p => [p.lng, p.lat]);

        let geojson: any = null;
        if (poi.type === 'area' && coords.length > 2) {
          geojson = {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Polygon',
              coordinates: [[...coords, coords[0]]]
            }
          };
        } else if (poi.type === 'path' && coords.length > 0) {
          geojson = {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: coords
            }
          };
        }

        if (geojson) {
          if (!map.current.getSource(sourceId)) {
            map.current.addSource(sourceId, { type: 'geojson', data: geojson });

            if (poi.type === 'area') {
              map.current.addLayer({
                id: fillLayerId,
                type: 'fill',
                source: sourceId,
                paint: {
                  'fill-color': poi.color || '#ef4444',
                  'fill-opacity': 0.3
                }
              });
              map.current.addLayer({
                id: lineLayerId,
                type: 'line',
                source: sourceId,
                paint: {
                  'line-color': poi.color || '#ef4444',
                  'line-width': 2.5
                }
              });
            } else {
              map.current.addLayer({
                id: lineLayerId,
                type: 'line',
                source: sourceId,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                  'line-color': poi.color || '#3b82f6',
                  'line-width': 3
                }
              });
            }
          } else {
            // Update data & ensure visible
            const src = map.current.getSource(sourceId) as maplibregl.GeoJSONSource;
            if (src) src.setData(geojson);
            if (map.current.getLayer(fillLayerId)) map.current.setLayoutProperty(fillLayerId, 'visibility', 'visible');
            if (map.current.getLayer(lineLayerId)) map.current.setLayoutProperty(lineLayerId, 'visibility', 'visible');
          }
        }
      }

      // Create a marker
      const el = document.createElement('div');
      el.className = 'marker';
      el.style.display = 'flex';
      el.style.flexDirection = 'column';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';

      const pinColor = poi.color || '#ef4444';
      const idLabel = poi.pdfTargetId || poi.name;
      
      let badgeHtml = '';
      if (idLabel) {
        const displayLabel = idLabel.startsWith('Alvo ') ? idLabel.replace('Alvo ', '') : idLabel;
        badgeHtml = `
          <div style="background-color: #ffffff; color: #dc2626; font-family: system-ui, -apple-system, sans-serif; font-size: 11px; font-weight: 900; padding: 2px 6px; border-radius: 4px; border: 1.5px solid #dc2626; margin-bottom: 4px; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.35); text-align: center; line-height: 1.2; z-index: 10;">
            ${displayLabel}
          </div>
        `;
      }

      const markerHtml = `
        <div style="display: flex; flex-direction: column; align-items: center; position: relative; cursor: pointer;">
          ${badgeHtml}
          <div style="position: relative; display: flex; align-items: center; justify-content: center;">
            <svg viewBox="0 0 24 24" fill="${pinColor}" stroke="#1e293b" stroke-width="1.5" style="width: 28px; height: 28px; filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.45));">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
              <circle cx="12" cy="9" r="3" fill="white" />
            </svg>
          </div>
        </div>
      `;

      el.innerHTML = markerHtml;

      const dmsLat = decimalToDMS(poi.lat, true);
      const dmsLng = decimalToDMS(poi.lng, false);

      const dmsStr = `${dmsLat.degrees}° ${dmsLat.minutes}' ${dmsLat.seconds.toFixed(0)}" ${dmsLat.direction}`;
      const dmsLngStr = `${dmsLng.degrees}° ${dmsLng.minutes}' ${dmsLng.seconds.toFixed(0)}" ${dmsLng.direction}`;

      let detailLabel = '';
      if (poi.polygonArea) {
        detailLabel = `<div><b>Área:</b> ${poi.polygonArea.toFixed(4)} ha</div>`;
      } else if (poi.type === 'path' && poi.pathDistance) {
        detailLabel = `<div><b>Distância:</b> ${poi.pathDistance.toFixed(2)} km</div>`;
      }

      const pointId = poi.pdfTargetId || poi.name.replace(/^Alvo\s+/i, '');

      const popupContent = `
        <div style="font-family: monospace; font-size: 10px; background-color: #f8fafc; padding: 7px; border-radius: 6px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 3.5px; min-width: 165px; color: #1e293b;">
          <div style="color: #dc2626; font-weight: bold; border-bottom: 1px solid #fee2e2; padding-bottom: 3.5px; margin-bottom: 1.5px; font-size: 10.5px;">
            <b>ID Ponto:</b> ${pointId}
          </div>
          ${detailLabel}
          <div><b>Lat:</b> ${dmsStr}</div>
          <div><b>Long:</b> ${dmsLngStr}</div>
          <div style="font-size: 9px; color: #94a3b8; border-top: 1px dashed #e2e8f0; padding-top: 3.5px; margin-top: 1.5px;">
            <b>DEC:</b> ${poi.lat.toFixed(6)}, ${poi.lng.toFixed(6)}
          </div>
        </div>
      `;

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([poi.lng, poi.lat])
        .setPopup(new maplibregl.Popup({ offset: 20 }).setHTML(popupContent))
        .addTo(map.current!);
      
      markers.current.push(marker);
      markersMap.current[poi.id] = marker;
    });

    // Clean up deleted ones
    const styleObj = map.current.getStyle();
    const existingPoiLayers = styleObj.layers?.filter(l => l.id.startsWith('poi-line-') || l.id.startsWith('poi-fill-')) || [];
    existingPoiLayers.forEach(layer => {
      const poiId = layer.id.replace('poi-line-', '').replace('poi-fill-', '');
      if (!pois.find(p => p.id === poiId)) {
        if (map.current?.getLayer(layer.id)) map.current.removeLayer(layer.id);
        if (map.current?.getSource(`poi-source-${poiId}`)) map.current.removeSource(`poi-source-${poiId}`);
      }
    });

  }, [pois, styleLoaded]);

  // Manage visibility of imported KMLs from appState
  useEffect(() => {
    if (!map.current || !styleLoaded || !appState?.importedKmls) return;

    appState.importedKmls.forEach((kml: any) => {
      const sourceId = `kml-source-${kml.id}`;
      const lineLayerId = `kml-line-layer-${kml.id}`;
      const fillLayerId = `kml-fill-layer-${kml.id}`;
      const circleLayerId = `kml-circle-layer-${kml.id}`;

      if (kml.visible) {
        if (!map.current?.getSource(sourceId)) {
          map.current?.addSource(sourceId, {
            type: 'geojson',
            data: kml.data
          });

          // Add Fill layer for Polygons
          map.current?.addLayer({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            filter: ['==', '$type', 'Polygon'],
            paint: {
              'fill-color': '#10b981',
              'fill-opacity': 0.3
            }
          });

          // Add Line layer for Lines/Polygons boundaries
          map.current?.addLayer({
            id: lineLayerId,
            type: 'line',
            source: sourceId,
            filter: ['in', '$type', 'LineString', 'Polygon'],
            paint: {
              'line-color': '#10b981',
              'line-width': 2.5
            }
          });

          // Add Circle layer for Points
          map.current?.addLayer({
            id: circleLayerId,
            type: 'circle',
            source: sourceId,
            filter: ['==', '$type', 'Point'],
            paint: {
              'circle-color': '#10b981',
              'circle-radius': 6,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1.5
            }
          });
        } else {
          if (map.current?.getLayer(fillLayerId)) map.current.setLayoutProperty(fillLayerId, 'visibility', 'visible');
          if (map.current?.getLayer(lineLayerId)) map.current.setLayoutProperty(lineLayerId, 'visibility', 'visible');
          if (map.current?.getLayer(circleLayerId)) map.current.setLayoutProperty(circleLayerId, 'visibility', 'visible');
        }
      } else {
        if (map.current?.getLayer(fillLayerId)) map.current.setLayoutProperty(fillLayerId, 'visibility', 'none');
        if (map.current?.getLayer(lineLayerId)) map.current.setLayoutProperty(lineLayerId, 'visibility', 'none');
        if (map.current?.getLayer(circleLayerId)) map.current.setLayoutProperty(circleLayerId, 'visibility', 'none');
      }
    });

    // Remove deleted KMLs
    const style = map.current.getStyle();
    const existingKmlLayerIds = style.layers?.filter(l => l.id.startsWith('kml-line-layer-')).map(l => l.id.replace('kml-line-layer-', '')) || [];
    existingKmlLayerIds.forEach(id => {
      if (!appState.importedKmls.find((k: any) => k.id === id)) {
        if (map.current?.getLayer(`kml-fill-layer-${id}`)) map.current.removeLayer(`kml-fill-layer-${id}`);
        if (map.current?.getLayer(`kml-line-layer-${id}`)) map.current.removeLayer(`kml-line-layer-${id}`);
        if (map.current?.getLayer(`kml-circle-layer-${id}`)) map.current.removeLayer(`kml-circle-layer-${id}`);
        if (map.current?.getSource(`kml-source-${id}`)) map.current.removeSource(`kml-source-${id}`);
      }
    });
  }, [appState?.importedKmls, styleLoaded]);

  useEffect(() => {
    if (!map.current || !styleLoaded) return;
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
  }, [currentRoute, styleLoaded]);

  useEffect(() => {
    if (!map.current || !styleLoaded) return;
    const source = map.current.getSource('selected-route') as maplibregl.GeoJSONSource;
    if (source) {
      const selectedRoute = appState?.routes?.find((r: any) => r.id === appState?.selectedRouteId);
      if (selectedRoute && selectedRoute.points.length > 0) {
        source.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: selectedRoute.points.map((p: any) => [p.lng, p.lat])
          }
        });
      } else {
        source.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: []
          }
        });
      }
    }
  }, [appState?.selectedRouteId, appState?.routes, styleLoaded]);

  useEffect(() => {
    if (!map.current || !styleLoaded) return;
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

    // Clear old measurement markers
    measurementMarkers.current.forEach(m => m.remove());
    measurementMarkers.current = [];

    // Redraw measurement point pins in a medium-dark yellow/amber tone
    measurementPoints.forEach((p, idx) => {
      const el = document.createElement('div');
      el.className = 'measurement-point-marker';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.innerHTML = `
        <div class="relative flex items-center justify-center">
          <div class="absolute w-5 h-5 bg-yellow-400 rounded-full opacity-35 animate-pulse"></div>
          <div class="w-4 h-4 bg-amber-600 rounded-full border border-white shadow-lg flex items-center justify-center text-white" style="font-family: system-ui, sans-serif; box-shadow: 0 1px 3px rgba(0,0,0,0.4);">
            <span class="text-[8px] font-extrabold leading-none">${idx + 1}</span>
          </div>
        </div>
      `;

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .addTo(map.current!);
      measurementMarkers.current.push(marker);
    });

    return () => {
      measurementMarkers.current.forEach(m => m.remove());
      measurementMarkers.current = [];
    };
  }, [measurementPoints, styleLoaded]);

  // GPS User Location Blue Dot reactive marker
  useEffect(() => {
    if (userLocationMarkerRef.current) {
      userLocationMarkerRef.current.remove();
      userLocationMarkerRef.current = null;
    }

    if (!map.current || !styleLoaded || !userLocation) return;

    const el = document.createElement('div');
    el.className = 'user-location-marker';
    el.innerHTML = `
      <div class="relative flex items-center justify-center">
        <div class="absolute w-6 h-6 bg-blue-500 rounded-full opacity-30 animate-pulse"></div>
        <div class="w-4 h-4 bg-blue-600 rounded-full border-2 border-white shadow-2xl flex items-center justify-center">
          <div class="w-1.5 h-1.5 bg-white rounded-full"></div>
        </div>
      </div>
    `;

    userLocationMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([userLocation.lng, userLocation.lat])
      .addTo(map.current);

    return () => {
      if (userLocationMarkerRef.current) {
        userLocationMarkerRef.current.remove();
        userLocationMarkerRef.current = null;
      }
    };
  }, [userLocation, styleLoaded]);

  return (
    <div className="absolute inset-0 w-full h-full bg-zinc-950 overflow-hidden">
      <div ref={mapContainer} className="w-full h-full block" />
      
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
         <svg className="absolute inset-0 pointer-events-none z-[5] w-full h-full">
            {(() => {
              const userPos = map.current.project([userLocation.lng, userLocation.lat]);
              const rect = mapContainer.current?.getBoundingClientRect();
              const centerPos = { 
                x: rect ? rect.width / 2 : window.innerWidth / 2, 
                y: rect ? rect.height / 2 : window.innerHeight / 2 
              };
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
