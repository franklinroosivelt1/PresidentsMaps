import React, { useState, useEffect, useCallback } from 'react';
const MapView = React.lazy(() => import('./components/MapView'));
import Sidebar from './components/Sidebar';
import CoordinatePanel from './components/CoordinatePanel';
import POIDialog from './components/POIDialog';
import { AppState, POI, RoutePoint, SavedRoute } from './types';
import * as turf from '@turf/turf';
import { cn } from './lib/utils';
import { Activity, Navigation, Save, Trash2, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ManualPointOverlay from './components/ManualPointOverlay';

const STORAGE_KEY = 'president_maps_v1';

const INITIAL_STATE: AppState = {
  pois: [],
  routes: [],
  importedKmls: [],
  importedMaps: [],
  activeLayer: 'google-hybrid',
  isRecording: false,
  currentRoute: [],
  measurementMode: 'off',
  measurementPoints: [],
  coordinateFormat: 'DMS',
  distanceUnit: 'mt',
  activeTab: 'tools',
  isSidebarOpen: false
};

export default function App() {
  const [appState, setAppState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...INITIAL_STATE, ...parsed, isRecording: false, currentRoute: [], measurementMode: 'off', measurementPoints: [] };
      } catch (e) {
        return INITIAL_STATE;
      }
    }
    return INITIAL_STATE;
  });

  const [displayCenter, setDisplayCenter] = useState({ 
    lat: appState.lastCenter?.lat ?? -23.5505, 
    lng: appState.lastCenter?.lng ?? -46.6333 
  });
  const [navigationTarget, setNavigationTarget] = useState<{ lat: number, lng: number, timestamp: number } | null>(
    appState.lastCenter ? { ...appState.lastCenter, timestamp: 0 } : null
  );
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingPOI, setPendingPOI] = useState<{ lat: number; lng: number } | null>(null);
  const [editingPOI, setEditingPOI] = useState<POI | null>(null);
  const [measurementName, setMeasurementName] = useState('');

  // Reset measurement name on mode change
  useEffect(() => {
    setMeasurementName('');
  }, [appState.measurementMode]);

  const [activeAddPoint, setActiveAddPoint] = useState(false);
  const [tempPoint, setTempPoint] = useState<{ lat: number; lng: number } | null>(null);

  const [hasInitialLocation, setHasInitialLocation] = useState(!!appState.lastCenter);

  // Persistence
  useEffect(() => {
    const { isRecording, currentRoute, measurementMode, measurementPoints, activeTab, isSidebarOpen, ...rest } = appState;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, lastCenter: displayCenter }));
  }, [appState.pois, appState.routes, appState.activeLayer, appState.importedKmls, appState.importedMaps, appState.coordinateFormat, appState.distanceUnit, displayCenter]);

  // Track User Location (Always)
  useEffect(() => {
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        
        if (!hasInitialLocation) {
          setNavigationTarget({ ...loc, timestamp: Date.now() });
          setHasInitialLocation(true);
        }
        
        if (appState.isRecording) {
          const newPoint: RoutePoint = {
            ...loc,
            timestamp: pos.timestamp
          };
          setAppState(prev => ({
            ...prev,
            currentRoute: [...prev.currentRoute, newPoint]
          }));
        }
      },
      (err) => console.error('Geoloc error:', err),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [appState.isRecording, hasInitialLocation]);

  const toggleRecording = useCallback(() => {
    if (appState.isRecording) {
      // Save route
      if (appState.currentRoute.length > 1) {
        const line = turf.lineString(appState.currentRoute.map(p => [p.lng, p.lat]));
        const distance = turf.length(line, { units: 'meters' });
        
        const newRoute: SavedRoute = {
          id: crypto.randomUUID(),
          name: `Trajeto ${new Date().toLocaleString()}`,
          points: appState.currentRoute,
          distance,
          createdAt: Date.now()
        };
        
        setAppState(prev => ({
          ...prev,
          routes: [newRoute, ...prev.routes],
          isRecording: false,
          currentRoute: []
        }));
      } else {
        setAppState(prev => ({ ...prev, isRecording: false, currentRoute: [] }));
      }
    } else {
      setAppState(prev => ({ ...prev, isRecording: true, currentRoute: [] }));
    }
  }, [appState.isRecording, appState.currentRoute]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) return;
    
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (data && data[0]) {
        const { lat, lon } = data[0];
        setNavigationTarget({ lat: parseFloat(lat), lng: parseFloat(lon), timestamp: Date.now() });
      }
    } catch (err) {
      console.error("Erro na busca:", err);
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    if (activeAddPoint) {
      setTempPoint({ lat, lng });
    }
  };

  const openAddPOIDialog = (lat: number, lng: number) => {
    setPendingPOI({ lat, lng });
    setIsDialogOpen(true);
  };

  const savePOI = (poiData: Omit<POI, 'id' | 'createdAt'>) => {
    if (editingPOI) {
      setAppState(prev => ({
        ...prev,
        pois: prev.pois.map(p => p.id === editingPOI.id ? { ...p, ...poiData } : p)
      }));
      setEditingPOI(null);
    } else {
      const newPOI: POI = {
        ...poiData,
        id: crypto.randomUUID(),
        createdAt: Date.now()
      };
      setAppState(prev => ({ ...prev, pois: [...prev.pois, newPOI] }));
    }
    setPendingPOI(null);
    setIsDialogOpen(false);
  };

  const handleAddMeasurementPoint = (lat: number, lng: number) => {
    setAppState(prev => ({
      ...prev,
      measurementPoints: [...prev.measurementPoints, { lat, lng }]
    }));
  };

  return (
    <div className="relative w-full h-[100dvh] bg-zinc-950 overflow-hidden">
      <React.Suspense fallback={
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 text-zinc-450 gap-3 z-10 font-sans">
          <div className="w-8 h-8 rounded-full border-2 border-zinc-800 border-t-emerald-500 animate-spin"></div>
          <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Abertura Segura do Mapa...</span>
        </div>
      }>
        <MapView 
          userLocation={userLocation}
          targetCenter={navigationTarget}
          pois={appState.pois} 
          importedMaps={appState.importedMaps}
          activeLayer={appState.activeLayer}
          currentRoute={appState.currentRoute}
          onCenterChange={(lat, lng) => setDisplayCenter({ lat, lng })}
          onMapClick={handleMapClick}
          onAddPOI={savePOI}
          measurementMode={appState.measurementMode}
          measurementPoints={appState.measurementPoints}
          onAddMeasurementPoint={handleAddMeasurementPoint}
          activeAddPoint={activeAddPoint}
          tempPoint={tempPoint}
          appState={appState}
        />
      </React.Suspense>
      
      <Sidebar 
        appState={appState} 
        setAppState={setAppState} 
        onToggleRecording={toggleRecording}
        onAddPoint={() => {
          setActiveAddPoint(true);
          setTempPoint({ lat: displayCenter.lat, lng: displayCenter.lng });
        }}
        onGoToPOI={(poi) => setNavigationTarget({ lat: poi.lat, lng: poi.lng, timestamp: Date.now() })}
        onGoToMap={(map) => setNavigationTarget({ lat: map.bounds[0][0], lng: map.bounds[0][1], timestamp: Date.now() })}
        onGoToRoute={(route) => {
          if (route.points.length > 0) {
            setNavigationTarget({ lat: route.points[0].lat, lng: route.points[0].lng, timestamp: Date.now() });
          }
        }}
        onEditPOI={(poi) => {
          setEditingPOI(poi);
          setIsDialogOpen(true);
        }}
      />

      <div className="absolute top-20 left-4 z-20 flex flex-col gap-2 print:hidden text-white">
        <button
          onClick={toggleRecording}
          className={cn(
            "p-3 rounded-xl shadow-2xl border transition-all",
            appState.isRecording 
              ? "bg-red-600 border-red-500 text-white animate-pulse" 
              : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white"
          )}
          title={appState.isRecording ? "Parar Gravação" : "Iniciar Gravação"}
        >
          <Activity className="w-6 h-6" />
        </button>

        <button
          onClick={() => {
            if (userLocation) {
              setNavigationTarget({ ...userLocation, timestamp: Date.now() });
            } else {
              alert('Aguardando sinal de GPS...');
            }
          }}
          className={cn(
            "p-3 border shadow-2xl transition-all active:scale-95 rounded-xl",
            userLocation 
              ? "bg-zinc-900 border-zinc-800 text-blue-400 hover:text-white" 
              : "bg-zinc-900/50 border-zinc-800/50 text-zinc-600 cursor-not-allowed"
          )}
          title="Minha Localização"
        >
          <Navigation className="w-6 h-6" />
        </button>
      </div>
      
      <CoordinatePanel lat={displayCenter.lat} lng={displayCenter.lng} format={appState.coordinateFormat} />

      {/* Print Legends - Only visible during print */}
      <div className="hidden print:flex fixed bottom-4 left-4 right-4 justify-between text-[10px] text-black font-mono bg-white/80 p-2 border border-black z-[100]">
        <div>LE: {displayCenter.lat.toFixed(6)}, {displayCenter.lng.toFixed(6)} (CENTRO)</div>
        <div>PresidentMaps - Localização Profissional</div>
      </div>
      
      {(pendingPOI || editingPOI) && (
        <POIDialog 
          isOpen={isDialogOpen}
          onClose={() => {
            setIsDialogOpen(false);
            setPendingPOI(null);
            setEditingPOI(null);
          }}
          onSave={savePOI}
          lat={editingPOI ? editingPOI.lat : pendingPOI!.lat}
          lng={editingPOI ? editingPOI.lng : pendingPOI!.lng}
          initialData={editingPOI || undefined}
        />
      )}
      
      {activeAddPoint && tempPoint && (
        <ManualPointOverlay 
          lat={tempPoint.lat}
          lng={tempPoint.lng}
          onCoordinatesChange={(lat, lng) => {
            setTempPoint({ lat, lng });
            setNavigationTarget({ lat, lng, timestamp: Date.now() });
          }}
          onSave={(name, lat, lng) => {
            const newPOI: POI = {
              id: crypto.randomUUID(),
              name: name || 'Ponto sem Nome',
              description: 'Marcador ajustado manualmente nas coordenadas.',
              lat,
              lng,
              color: '#ef4444',
              createdAt: Date.now(),
              visible: true
            };
            setAppState(prev => ({ ...prev, pois: [...prev.pois, newPOI] }));
            setActiveAddPoint(false);
            setTempPoint(null);
            alert(`Ponto "${newPOI.name}" foi fixado com sucesso!`);
          }}
          onCancel={() => {
            setActiveAddPoint(false);
            setTempPoint(null);
          }}
        />
      )}

      {/* FAB Check Button for center marking in measurement mode */}
      <AnimatePresence>
        {appState.measurementMode !== 'off' && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20 print:hidden">
            <motion.button
              initial={{ opacity: 0, y: 15, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 15, scale: 0.9 }}
              onClick={() => handleAddMeasurementPoint(displayCenter.lat, displayCenter.lng)}
              className="bg-emerald-700 hover:bg-emerald-600 border border-emerald-600/40 text-white font-bold py-3 px-5 rounded-full shadow-2xl flex items-center gap-2 text-xs uppercase tracking-widest transition-all active:scale-95 cursor-pointer font-sans"
              title="Marcar ponto no local desejado (Check)"
            >
              <Check className="w-4 h-4" />
              <span>Marcar Ponto</span>
            </motion.button>
          </div>
        )}
      </AnimatePresence>

      {/* Search HUD Placeholder (Standard Browser Search or can be refined) */}
      <div className="absolute top-4 right-4 z-20 pointer-events-none flex flex-col items-end gap-3 max-w-[calc(100vw-32px)]">
          <AnimatePresence>
            {appState.measurementMode !== 'off' && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-[#384a34] text-[#f4f7f4] p-4 rounded-2xl shadow-2xl pointer-events-auto flex flex-col items-center min-w-[200px] border border-[#50664b]/60 backdrop-blur"
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-80 mb-1">
                  {appState.measurementMode === 'area' ? '📐 Calcular Área' : '📏 Medir Distância (km)'}
                </div>
                
                <div className="font-mono text-lg font-bold">
                  {appState.measurementMode === 'area' ? (
                    appState.measurementPoints.length > 2 ? (
                      <span>
                        {(turf.area(turf.polygon([[...appState.measurementPoints, appState.measurementPoints[0]].map(p => [p.lng, p.lat])])) / 10000).toFixed(2)} ha
                      </span>
                    ) : (
                      <span className="text-[10px] font-sans font-medium opacity-80 block text-center max-w-[150px]">Selecione ao menos 3 pontos para calcular uma área.</span>
                    )
                  ) : (
                    appState.measurementPoints.length > 1 ? (
                      <span>
                        {(() => {
                          const dist = turf.length(turf.lineString(appState.measurementPoints.map(p => [p.lng, p.lat])), { units: 'meters' });
                          return `${(dist / 1000).toFixed(3)} km`;
                        })()}
                      </span>
                    ) : (
                      <span className="text-[10px] font-sans font-medium opacity-80 block text-center max-w-[150px]">Selecione os pontos para medir a distância</span>
                    )
                  )}
                </div>

                {appState.measurementPoints.length >= (appState.measurementMode === 'area' ? 3 : 2) && (
                  <div className="w-full mt-3 flex flex-col gap-1 text-left pointer-events-auto">
                    <label className="text-[9px] uppercase tracking-wider text-[#93c5fd]/80 font-semibold font-sans">Nome do elemento</label>
                    <input
                      type="text"
                      value={measurementName}
                      onChange={(e) => setMeasurementName(e.target.value)}
                      placeholder={appState.measurementMode === 'area' ? 'Área Demarcada' : 'Caminho Criado'}
                      className="w-full bg-[#2a3c26] text-white text-xs px-2.5 py-1.5 rounded-lg border border-[#50664b]/65 focus:outline-none focus:border-yellow-400 placeholder-[#bfc8bd]/50 font-sans"
                    />
                  </div>
                )}

                <div className="flex gap-2 w-full mt-3 font-sans">
                  <button 
                    onClick={() => {
                      const modeIsArea = appState.measurementMode === 'area';
                      const minPoints = modeIsArea ? 3 : 2;
                      if (appState.measurementPoints.length < minPoints) {
                        return;
                      }

                      const defaultName = modeIsArea ? 'Área Demarcada' : 'Caminho Criado';
                      const finalName = measurementName.trim() || defaultName;

                      // Calculate average centroid/start
                      let sumLat = 0;
                      let sumLng = 0;
                      appState.measurementPoints.forEach(p => {
                        sumLat += p.lat;
                        sumLng += p.lng;
                      });
                      const avgLat = sumLat / appState.measurementPoints.length;
                      const avgLng = sumLng / appState.measurementPoints.length;

                      let calcVal = 0;
                      if (modeIsArea) {
                        calcVal = turf.area(turf.polygon([[...appState.measurementPoints, appState.measurementPoints[0]].map(p => [p.lng, p.lat])])) / 10000;
                      } else {
                        calcVal = turf.length(turf.lineString(appState.measurementPoints.map(p => [p.lng, p.lat])), { units: 'kilometers' });
                      }

                      const newPOI: POI = {
                        id: crypto.randomUUID(),
                        name: finalName,
                        description: modeIsArea 
                          ? `Identificação de Área Demarcada (${calcVal.toFixed(2)} ha)` 
                          : `Identificação de Caminho criado (${calcVal.toFixed(3)} km)`,
                        lat: avgLat,
                        lng: avgLng,
                        color: modeIsArea ? '#eab308' : '#3b82f6', // Changed to match yellow
                        createdAt: Date.now(),
                        visible: true,
                        type: modeIsArea ? 'area' : 'path',
                        pathPoints: appState.measurementPoints,
                        polygonArea: modeIsArea ? parseFloat(calcVal.toFixed(2)) : undefined,
                        pathDistance: !modeIsArea ? parseFloat(calcVal.toFixed(3)) : undefined
                      };

                      setAppState(prev => ({
                        ...prev,
                        pois: [...prev.pois, newPOI],
                        measurementMode: 'off',
                        measurementPoints: [],
                        isSidebarOpen: true,
                        activeTab: 'markers'
                      }));
                      setMeasurementName('');
                    }}
                    disabled={appState.measurementPoints.length < (appState.measurementMode === 'area' ? 3 : 2)}
                    className="flex-1 flex items-center justify-center bg-white hover:bg-zinc-100 disabled:bg-white/20 disabled:text-zinc-500 disabled:cursor-not-allowed text-[#384a34] font-bold py-1.5 px-3 rounded-lg transition-colors cursor-pointer"
                    title="Salvar"
                  >
                    <Save className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => {
                      setAppState(prev => ({
                        ...prev,
                        measurementMode: 'off',
                        measurementPoints: []
                      }));
                      setMeasurementName('');
                    }}
                    className="flex-1 flex items-center justify-center bg-black/40 hover:bg-black/60 text-white font-bold py-1.5 px-3 rounded-lg transition-colors cursor-pointer"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {appState.isRecording && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="bg-zinc-900 border border-zinc-800 text-white px-5 py-4 rounded-3xl shadow-2xl flex flex-col items-center gap-2 min-w-[200px]"
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Gravando Trajeto</span>
                </div>
                <div className="flex items-baseline gap-4 mt-1">
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] uppercase text-zinc-500 font-bold tracking-widest mb-0.5">Tempo</span>
                    <span className="text-lg font-mono font-bold leading-none">
                      {(() => {
                        if (appState.currentRoute.length < 2) return "00:00";
                        const start = appState.currentRoute[0].timestamp;
                        const end = appState.currentRoute[appState.currentRoute.length - 1].timestamp;
                        const diff = Math.floor((end - start) / 1000);
                        const mins = Math.floor(diff / 60);
                        const secs = diff % 60;
                        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                      })()}
                    </span>
                  </div>
                  <div className="w-px h-6 bg-zinc-800 self-center" />
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] uppercase text-zinc-500 font-bold tracking-widest mb-0.5">Distância</span>
                    <span className="text-lg font-mono font-bold leading-none">
                      {(() => {
                        if (appState.currentRoute.length < 2) return "0m";
                        const line = turf.lineString(appState.currentRoute.map(p => [p.lng, p.lat]));
                        const dist = turf.length(line, { units: 'meters' });
                        return appState.distanceUnit === 'km' ? `${(dist / 1000).toFixed(2)}km` : `${dist.toFixed(0)}m`;
                      })()}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
      </div>
    </div>
  );
}

