import React, { useState, useEffect, useCallback, useRef } from 'react';
const MapView = React.lazy(() => import('./components/MapView'));
import Sidebar from './components/Sidebar';
import CoordinatePanel from './components/CoordinatePanel';
import POIDialog from './components/POIDialog';
import { AppState, POI, RoutePoint, SavedRoute } from './types';
import * as turf from '@turf/turf';
import { cn } from './lib/utils';
import { Activity, Navigation, Save, Trash2, Check, HelpCircle } from 'lucide-react';
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
  isSidebarOpen: false,
  selectedRouteId: null
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
  const [showGpsHelper, setShowGpsHelper] = useState(false);

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
  }, [appState.pois, appState.routes, appState.activeLayer, appState.importedKmls, appState.importedMaps, appState.coordinateFormat, appState.distanceUnit, appState.selectedRouteId, displayCenter]);

  // Screen Wake Lock API integration to retain CPU and GPS in background or locked state
  const [wakeLock, setWakeLock] = useState<any | null>(null);

  // Background silent audio to trick operating systems (Android/iOS) into maintaining the tab thread active
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const startSilentAudio = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      // Create a 1-second buffer
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      
      // Generate a practically silent 1Hz wave at extremely low amplitude (0.00001)
      // This is inaudible but forces the browser and OS to preserve the process
      for (let i = 0; i < buffer.length; i++) {
        data[i] = Math.sin((2 * Math.PI * 1 * i) / ctx.sampleRate) * 0.00001;
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      
      source.connect(ctx.destination);
      source.start();
      audioSourceRef.current = source;
      console.log('Background silent audio started to maintain GPS tracking.');
    } catch (err) {
      console.error('Failed to start background silent audio:', err);
    }
  }, []);

  const stopSilentAudio = useCallback(() => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {}
      audioSourceRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
    }
    console.log('Background silent audio stopped.');
  }, []);

  useEffect(() => {
    return () => {
      // Clean up silent audio on unmount
      if (audioSourceRef.current) {
        try { audioSourceRef.current.stop(); } catch(e){}
      }
      if (audioContextRef.current) {
        try { audioContextRef.current.close(); } catch(e){}
      }
    };
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      setWakeLock(lock);
      console.log('Wake Lock active!');
    } catch (err) {
      console.error('Wake Lock failed:', err);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLock) {
      try {
        await wakeLock.release();
        setWakeLock(null);
        console.log('Wake Lock released.');
      } catch (err) {
        console.error('Wake Lock release error:', err);
      }
    }
  }, [wakeLock]);

  // Request/release lock based on isRecording status
  useEffect(() => {
    if (appState.isRecording) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [appState.isRecording, requestWakeLock, releaseWakeLock]);

  // If page visibility changes (user locks/unlocks or switches tabs), re-acquire Wake Lock
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && appState.isRecording) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [appState.isRecording, requestWakeLock]);

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
      { 
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000 
      }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [appState.isRecording, hasInitialLocation]);

  const toggleRecording = useCallback(() => {
    if (appState.isRecording) {
      stopSilentAudio();
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
      startSilentAudio();
      setAppState(prev => ({ ...prev, isRecording: true, currentRoute: [] }));
    }
  }, [appState.isRecording, appState.currentRoute, startSilentAudio, stopSilentAudio]);

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
          setAppState(prev => ({ ...prev, selectedRouteId: route.id }));
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
      
      {showGpsHelper && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 text-white rounded-3xl p-6 max-w-md w-full shadow-2xl flex flex-col gap-4 font-sans"
          >
            <div className="flex items-center gap-3 border-b border-zinc-800 pb-3">
              <span className="p-2 rounded-xl bg-orange-550/10 text-orange-400">
                <HelpCircle className="w-6 h-6" />
              </span>
              <div>
                <h3 className="text-base font-bold text-zinc-100">Precisão do GPS & Gravação</h3>
                <p className="text-[10px] text-zinc-400">Evite traçados em linha reta ao bloquear o celular</p>
              </div>
            </div>

            <div className="text-xs text-zinc-300 flex flex-col gap-3.5 leading-relaxed">
              <p>
                Os sistemas operacionais <strong>Android e iOS</strong> suspendem agressivamente os navegadores (Chrome, Safari, etc.) e cortam o sinal de GPS quando o celular é bloqueado manualmente pelo botão liga/desliga para economizar bateria. Isso faz com que a gravação pare e conecte com uma linha reta ao ser desbloqueado.
              </p>

              <div className="space-y-3 pt-1">
                <div className="flex gap-2.5">
                  <span className="text-emerald-400 font-bold shrink-0">1.</span>
                  <div>
                    <strong className="text-zinc-100 block mb-0.5">Mantenha a Tela Ativa (Recomendado)</strong>
                    O app ativa o <strong>Screen Wake Lock</strong> automaticamente para impedir que a tela apague sozinha. Basta deixar o aparelho com o app aberto. Dica: você pode reduzir o brilho da tela ao mínimo para economizar bateria!
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <span className="text-emerald-400 font-bold shrink-0">2.</span>
                  <div>
                    <strong className="text-zinc-100 block mb-0.5">Nova Tecnologia de Fundo Inclusa!</strong>
                    Acabamos de integrar um sistema de <strong>Áudio Silencioso Sub-sensorial</strong>. Ao gravar, o app emite uma onda inaudível contínua para sinalizar ao sistema do celular que a aba está "ativa", minimizando as chances de suspensão do GPS em segundo plano.
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <span className="text-emerald-400 font-bold shrink-0">3.</span>
                  <div>
                    <strong className="text-zinc-100 block mb-0.5">Configuração no Android (Opcional)</strong>
                    Para máxima eficiência em segundo plano, acesse as Informações do Aplicativo do seu navegador (Chrome), vá em <em>Bateria</em> e defina como <strong>"Sem restrições"</strong> (ou Economia de Bateria Desativada) e conceda permissão de <em>Localização</em> como <strong>"Permitir o tempo todo"</strong>.
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowGpsHelper(false)}
              className="mt-2 w-full bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-3 px-4 rounded-xl transition-colors cursor-pointer"
            >
              Entendi, obrigado!
            </button>
          </motion.div>
        </div>
      )}

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
                <button
                  type="button"
                  onClick={() => setShowGpsHelper(true)}
                  className="text-[9px] text-zinc-400 font-bold hover:text-white uppercase tracking-wider text-center pt-2.5 border-t border-zinc-800 w-full flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  title="Dicas para gravação perfeita"
                >
                  <span>⚠️ Tela Ativa para Gravação</span>
                  <HelpCircle className="w-3 h-3 text-emerald-400" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
      </div>
    </div>
  );
}

