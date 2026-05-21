import React, { useState } from 'react';
import { 
  Menu, X, Map as MapIcon, Layers, MapPin, 
  Settings, Download, Activity, Ruler, Trash2, 
  ChevronRight, Save, Share2, LocateFixed, Eye, EyeOff, Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { MapLayer, POI, AppState, SavedRoute, ImportedMap } from '../types';
import { exportToKML } from '../lib/kml';
import { processGeoPDF } from '../services/mapImporter';
import { parseKMLToGeoJSON } from '../services/kmlParser';
import * as turf from '@turf/turf';

interface SidebarProps {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  onToggleRecording: () => void;
  onAddPoint: () => void;
  onGoToPOI: (poi: POI) => void;
  onGoToMap: (map: ImportedMap) => void;
  onEditPOI: (poi: POI) => void;
  onGoToRoute: (route: SavedRoute) => void;
}

interface POIItemProps {
  poi: POI;
  onGoToPOI: (poi: POI) => void;
  onEditPOI: (poi: POI) => void;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  removePOI: (id: string) => void;
  key?: string | number;
}

function POIItem({ poi, onGoToPOI, onEditPOI, setAppState, removePOI }: POIItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  
  return (
    <div className="group bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700 transition-all overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: poi.color }} />
          <span className={cn("font-bold text-sm truncate", poi.visible === false && "opacity-40 italic")}>{poi.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => onGoToPOI(poi)}
            className="p-1 px-2 bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase rounded-lg border border-blue-500/20 hover:bg-blue-500 hover:text-white transition-all"
          >
            Ir
          </button>
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className={cn("p-1.5 rounded-lg transition-colors", showMenu ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-white")}
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      <AnimatePresence>
        {showMenu && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="pt-3 mt-3 border-t border-zinc-800/50 flex items-center justify-between"
          >
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setAppState(prev => ({ 
                  ...prev, 
                  pois: prev.pois.map(p => p.id === poi.id ? { ...p, visible: p.visible === false ? true : false } : p)
                }))} 
                className={cn("p-2 transition-colors rounded-lg hover:bg-zinc-800", poi.visible === false ? "text-zinc-600" : "text-blue-500")}
                title={poi.visible === false ? "Mostrar" : "Ocultar"}
              >
                {poi.visible === false ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button 
                onClick={() => onEditPOI(poi)}
                className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                title="Editar"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button 
                onClick={() => {
                  const text = `Ponto: ${poi.name}\nLat: ${poi.lat}\nLng: ${poi.lng}`;
                  navigator.clipboard.writeText(text);
                  alert('Dados do ponto copiados!');
                }}
                className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                title="Compartilhar"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
            <button 
              onClick={() => removePOI(poi.id)} 
              className="p-2 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors" 
              title="Excluir"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface RouteItemProps {
  route: SavedRoute;
  onGoToRoute: (route: SavedRoute) => void;
  removeRoute: (id: string) => void;
  key?: string | number;
}

function RouteItem({ route, onGoToRoute, removeRoute }: RouteItemProps) {
  const [showMenu, setShowMenu] = useState(false);
  
  return (
    <div className="group bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700 transition-all overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm truncate text-white">{route.name}</div>
          <div className="text-[10px] text-zinc-500 font-mono">{(route.distance / 1000).toFixed(2)} km • {new Date(route.createdAt).toLocaleDateString()}</div>
        </div>
        <div className="flex items-center gap-1">
          <button 
            onClick={() => onGoToRoute(route)}
            className="p-1 px-2 bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase rounded-lg border border-blue-500/20 hover:bg-blue-500 hover:text-white transition-all"
          >
            Ir
          </button>
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className={cn("p-1.5 rounded-lg transition-colors", showMenu ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-white")}
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      <AnimatePresence>
        {showMenu && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="pt-3 mt-3 border-t border-zinc-800/50 flex items-center justify-between"
          >
            <div className="flex items-center gap-1">
              <button 
                onClick={() => {
                  const text = `Trajeto: ${route.name}\nDistância: ${(route.distance / 1000).toFixed(2)}km\nData: ${new Date(route.createdAt).toLocaleDateString()}\nPontos: ${route.points.length}`;
                  navigator.clipboard.writeText(text);
                  alert('Dados do trajeto copiados!');
                }}
                className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
                title="Compartilhar"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </div>
            <button 
              onClick={() => removeRoute(route.id)} 
              className="p-2 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors" 
              title="Excluir"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Sidebar({ appState, setAppState, onToggleRecording, onAddPoint, onGoToPOI, onGoToMap, onEditPOI, onGoToRoute }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'tools' | 'markers' | 'routes' | 'layers' | 'settings'>('tools');

  const layers: { id: MapLayer; name: string; description: string }[] = [
    { id: 'google-satellite', name: 'Google Satélite', description: 'Imagens de satélite puras' },
    { id: 'google-hybrid', name: 'Google Híbrido', description: 'Satélite com nomes de ruas e estradas' },
    { id: 'osm', name: 'OpenStreetMap', description: 'Mapa colaborativo global detalhado' },
  ];

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const result = await processGeoPDF(file);
        const newMap: ImportedMap = {
          id: crypto.randomUUID(),
          name: file.name,
          url: result.image,
          bounds: result.bounds,
          visible: true
        };
        setAppState(prev => ({ 
          ...prev, 
          importedMaps: [...prev.importedMaps, newMap],
          lastCenter: { lat: result.bounds[0][0], lng: result.bounds[0][1] }
        }));
        onGoToMap(newMap);
        alert(`Mapa "${file.name}" importado com sucesso!`);
      } catch (err: any) {
        console.error("Falha ao importar mapa:", err);
        alert(`Erro ao importar PDF: ${err.message || 'Verifique o arquivo ou tente outro.'}`);
      }
    }
  };

  const handleKmlImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (!text) return;
        try {
          const geojson = parseKMLToGeoJSON(text);
          if (geojson && geojson.features && geojson.features.length > 0) {
            const newLayer = {
              id: crypto.randomUUID(),
              name: file.name.replace(/\.[^/.]+$/, ""), // Strip extension
              visible: true,
              data: geojson 
            };
            setAppState(prev => ({ 
              ...prev, 
              importedKmls: [...prev.importedKmls, newLayer] 
            }));
            alert(`Camada KML "${file.name}" importada com sucesso! (${geojson.features.length} elementos carregados).`);
          } else {
            alert('Nenhum elemento geométrico compatível (e.g., Placemarks com Point/LineString/Polygon) foi encontrado no arquivo KML.');
          }
        } catch (err) {
          console.error("Erro KML:", err);
          alert('Não foi possível ler este arquivo KML. Verifique o seu formato.');
        }
      };
      reader.readAsText(file);
    }
  };

  const clearRoutes = () => {
    if (confirm('Deseja apagar todos os trajetos gravados?')) {
      setAppState(prev => ({ ...prev, routes: [] }));
    }
  };

  const removeRoute = (id: string) => {
    setAppState(prev => ({ ...prev, routes: prev.routes.filter(r => r.id !== id) }));
  };

  const removePOI = (id: string) => {
    setAppState(prev => ({ ...prev, pois: prev.pois.filter(p => p.id !== id) }));
  };

  const removeImportedKml = (id: string) => {
    setAppState(prev => ({ ...prev, importedKmls: prev.importedKmls.filter(k => k.id !== id) }));
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="absolute top-4 left-4 z-20 p-3 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl hover:bg-zinc-800 transition-colors"
      >
        <Menu className="w-6 h-6 text-zinc-100" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute top-0 left-0 h-full w-80 bg-zinc-950 border-r border-zinc-800 z-40 flex flex-col shadow-2xl"
            >
              <div className="p-6 border-bottom border-zinc-800 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">PresidentMaps</h2>
                  <p className="text-xs text-zinc-500 font-mono">Navegação Profissional</p>
                </div>
                <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-zinc-900 rounded-lg">
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>

              <div className="flex border-b border-zinc-900 px-2 overflow-x-auto no-scrollbar">
                {[
                  { id: 'tools', icon: Ruler, label: 'Ferramentas' },
                  { id: 'markers', icon: MapPin, label: 'Pontos' },
                  { id: 'routes', icon: Activity, label: 'Meus Trajetos' },
                  { id: 'layers', icon: Layers, label: 'Camadas' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={cn(
                      "flex flex-col items-center gap-1 py-3 px-4 transition-colors relative min-w-[72px]",
                      activeTab === tab.id ? "text-blue-500" : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    <tab.icon className="w-5 h-5" />
                    <span className="text-[10px] uppercase font-bold tracking-wider">{tab.label}</span>
                    {activeTab === tab.id && (
                      <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />
                    )}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {activeTab === 'layers' && (
                  <div className="space-y-6">
                    <section>
                      <div className="flex items-center justify-between mb-3 px-1">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Importadas (KML)</h3>
                        <label className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 cursor-pointer transition-colors">
                          <MapIcon className="w-4 h-4 text-blue-500" />
                          <input type="file" accept=".kml" className="hidden" onChange={handleKmlImport} />
                        </label>
                      </div>
                      <div className="space-y-2">
                        {appState.importedKmls.length === 0 ? (
                          <p className="text-[10px] text-zinc-600 text-center py-4 italic">Nenhuma camada importada.</p>
                        ) : (
                          appState.importedKmls.map(kml => (
                            <div key={kml.id} className="flex items-center justify-between p-2 bg-zinc-900/50 border border-zinc-800 rounded-lg">
                              <span className="text-xs font-medium text-zinc-300 truncate max-w-[150px]">{kml.name}</span>
                              <div className="flex items-center gap-1">
                                <button 
                                  onClick={() => setAppState(prev => ({
                                    ...prev,
                                    importedKmls: prev.importedKmls.map(k => k.id === kml.id ? { ...k, visible: !k.visible } : k)
                                  }))}
                                  className={cn("p-1.5", kml.visible ? "text-blue-500" : "text-zinc-600")}
                                >
                                  {kml.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={() => removeImportedKml(kml.id)} className="p-1.5 text-zinc-600 hover:text-red-500">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </section>

                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3 px-1">Da Internet</h3>
                      <div className="space-y-2">
                        {layers.map((layer) => (
                          <button
                            key={layer.id}
                            onClick={() => setAppState(prev => ({ ...prev, activeLayer: layer.id }))}
                            className={cn(
                              "w-full p-3 rounded-xl border text-left transition-all",
                              appState.activeLayer === layer.id 
                                ? "bg-blue-600/10 border-blue-600/50 text-blue-400" 
                                : "bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                            )}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-sm">{layer.name}</span>
                              {appState.activeLayer === layer.id && <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />}
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                )}

                {activeTab === 'markers' && (
                  <div className="space-y-3">
                    <button 
                      onClick={() => exportToKML(appState.pois)}
                      className="w-full flex items-center justify-center gap-2 p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-zinc-800 transition-colors"
                    >
                      <Share2 className="w-4 h-4" />
                      Exportar Para KML
                    </button>
                    
                      <div className="space-y-2">
                        {appState.pois.length === 0 ? (
                          <p className="text-center text-zinc-600 py-10 text-sm">Nenhum marcador adicionado.</p>
                        ) : (
                          appState.pois.map(poi => (
                            <POIItem 
                              key={poi.id} 
                              poi={poi} 
                              onGoToPOI={onGoToPOI} 
                              onEditPOI={onEditPOI}
                              setAppState={setAppState} 
                              removePOI={removePOI} 
                            />
                          ))
                        )}
                      </div>
                  </div>
                )}

                {activeTab === 'routes' && (
                  <div className="space-y-4">
                    <button
                      onClick={onToggleRecording}
                      className={cn(
                        "w-full flex items-center justify-center gap-3 p-4 rounded-xl border font-bold uppercase tracking-widest text-xs transition-all",
                        appState.isRecording 
                          ? "bg-red-600/20 border-red-600 text-red-500 animate-pulse" 
                          : "bg-blue-600 text-white border-blue-500 hover:bg-blue-500"
                      )}
                    >
                      <Activity className={cn("w-5 h-5", appState.isRecording && "animate-spin-slow")} />
                      {appState.isRecording ? 'Parar Gravação' : 'Gravar Trajeto'}
                    </button>

                    <div className="flex items-center justify-between px-1">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Histórico</h3>
                      <button onClick={clearRoutes} className="text-[10px] text-zinc-600 hover:text-red-400 font-bold uppercase">Limpar Tudo</button>
                    </div>

                    <div className="space-y-2">
                      {appState.routes.length === 0 ? (
                        <p className="text-center text-zinc-600 py-10 text-sm">Nenhum trajeto salvo.</p>
                      ) : (
                        appState.routes.map(route => (
                          <RouteItem 
                            key={route.id} 
                            route={route} 
                            onGoToRoute={onGoToRoute} 
                            removeRoute={removeRoute} 
                          />
                        ))
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'tools' && (
                  <div className="space-y-4">
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3 px-1">Ferramentas de Mapa</h3>
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        <button 
                          onClick={() => {
                            setIsOpen(false);
                            onAddPoint();
                          }}
                          className="p-3 rounded-xl border bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 flex flex-col items-center gap-2 transition-all col-span-2"
                        >
                          <MapPin className="w-5 h-5 text-blue-500" />
                          <span className="text-[10px] font-bold uppercase">Adicionar Ponto</span>
                        </button>
                      </div>

                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3 px-1">Medições</h3>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { id: 'straight', label: 'Distância', icon: Ruler },
                          { id: 'area', label: 'Área (ha)', icon: Share2 },
                        ].map((mode) => (
                          <button
                            key={mode.id}
                            onClick={() => setAppState(prev => ({ 
                              ...prev, 
                              measurementMode: prev.measurementMode === mode.id ? 'off' : mode.id as any, 
                              measurementPoints: [] 
                            }))}
                            className={cn(
                              "p-3 rounded-xl border flex flex-col items-center gap-2 transition-all",
                              appState.measurementMode === mode.id 
                                ? "bg-blue-600/10 border-blue-600 text-blue-500" 
                                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                            )}
                          >
                            <mode.icon className="w-5 h-5" />
                            <span className="text-[10px] font-bold uppercase">{mode.label}</span>
                          </button>
                        ))}
                      </div>
                      
                      {appState.measurementPoints.length > 0 && (
                        <div className="mt-4 p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                              {appState.measurementMode === 'area' ? 'Área Total' : 'Distância Total'}
                            </span>
                            <button 
                              onClick={() => setAppState(prev => ({ ...prev, measurementPoints: [] }))}
                              className="text-[10px] text-red-500 font-bold uppercase"
                            >
                              Limpar
                            </button>
                          </div>
                          <p className="text-2xl font-mono font-bold text-white leading-none">
                            {(() => {
                              if (appState.measurementPoints.length < 2) return '0.00';
                              if (appState.measurementMode === 'area') {
                                if (appState.measurementPoints.length < 3) return '0.00';
                                const polygon = turf.polygon([[...appState.measurementPoints, appState.measurementPoints[0]].map(p => [p.lng, p.lat])]);
                                return (turf.area(polygon) / 10000).toFixed(2);
                              }
                              const line = turf.lineString(appState.measurementPoints.map(p => [p.lng, p.lat]));
                              const dist = turf.length(line, { units: 'meters' });
                              return appState.distanceUnit === 'km' ? (dist / 1000).toFixed(3) : dist.toFixed(0);
                            })()}
                            <span className="text-sm font-sans ml-1 text-zinc-500">
                              {appState.measurementMode === 'area' ? 'ha' : (appState.distanceUnit === 'km' ? 'km' : 'm')}
                            </span>
                          </p>
                        </div>
                      )}
                    </section>
                    
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3 px-1">Camadas de Mapa</h3>
                      <div className="flex flex-col gap-2">
                        <label className="w-full flex items-center justify-center gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-xl font-bold uppercase tracking-widest text-xs hover:border-zinc-600 transition-all text-blue-500 cursor-pointer">
                          <Download className="w-5 h-5 flex-shrink-0" />
                          Importar Mapa (GeoPDF)
                          <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
                        </label>

                        <label className="w-full flex items-center justify-center gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-xl font-bold uppercase tracking-widest text-xs hover:border-zinc-600 transition-all text-emerald-500 cursor-pointer">
                          <Download className="w-5 h-5 flex-shrink-0 text-emerald-500" />
                          Importar Camada (KML)
                          <input type="file" accept=".kml" className="hidden" onChange={handleKmlImport} />
                        </label>
                      </div>

                      {appState.importedKmls.length > 0 && (
                        <div className="mt-6 space-y-3">
                          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3 px-1">Camadas (.KML)</h3>
                          <div className="space-y-2">
                            {appState.importedKmls.map((kml) => (
                              <div key={kml.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] font-bold text-white truncate">{kml.name}</div>
                                  <div className="text-[9px] text-emerald-500/80 truncate">Vetor / Camada Digital</div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button 
                                    onClick={() => {
                                      setAppState(prev => ({
                                        ...prev,
                                        importedKmls: prev.importedKmls.map(k => k.id === kml.id ? { ...k, visible: !k.visible } : k)
                                      }));
                                    }}
                                    className={cn("p-1.5 rounded-lg transition-colors", kml.visible ? "text-emerald-500" : "text-zinc-600")}
                                    title={kml.visible ? "Ocultar" : "Mostrar"}
                                  >
                                    {kml.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                  </button>
                                  <button 
                                    onClick={() => {
                                      const kmlText = `Camada KML: ${kml.name}\nElementos: ${kml.data?.features?.length || 0}`;
                                      navigator.clipboard.writeText(kmlText);
                                      alert('Informações da camada KML copiadas para área de transferência!');
                                    }}
                                    className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                                    title="Compartilhar"
                                  >
                                    <Share2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      setAppState(prev => ({
                                        ...prev,
                                        importedKmls: prev.importedKmls.filter(k => k.id !== kml.id)
                                      }));
                                    }}
                                    className="p-1.5 text-zinc-650 hover:text-red-500 transition-colors"
                                    title="Excluir"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {appState.importedMaps.length > 0 && (
                        <div className="mt-6 space-y-3">
                          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3 px-1">Mapas Importados</h3>
                          <div className="space-y-2">
                            {appState.importedMaps.map((map) => (
                              <div key={map.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 flex items-center justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] font-bold text-white truncate">{map.name}</div>
                                  <div className="text-[9px] text-zinc-500 truncate">Georreferenciado</div>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button 
                                    onClick={() => onGoToMap(map)}
                                    className="p-1 px-2 bg-blue-500/10 text-blue-400 text-[10px] font-bold uppercase rounded-lg border border-blue-500/20 hover:bg-blue-500 hover:text-white transition-all"
                                  >
                                    Ir
                                  </button>
                                  <button 
                                    onClick={() => setAppState(prev => ({
                                      ...prev,
                                      importedMaps: prev.importedMaps.map(m => m.id === map.id ? { ...m, visible: !m.visible } : m)
                                    }))}
                                    className={cn("p-2 rounded-lg transition-colors", map.visible ? "text-blue-500" : "text-zinc-600")}
                                  >
                                    {map.visible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                                  </button>
                                  <button 
                                    onClick={() => setAppState(prev => ({
                                      ...prev,
                                      importedMaps: prev.importedMaps.filter(m => m.id !== map.id)
                                    }))}
                                    className="p-2 text-zinc-600 hover:text-red-500 transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  </div>
                )}
                {activeTab === 'settings' && (
                  <div className="space-y-6">
                    <section>
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-4 px-1">Configurações de Exibição</h3>
                      <div className="space-y-4">
                        <div className="bg-blue-600/10 border border-blue-500/20 p-4 rounded-2xl flex items-center gap-3">
                          <div className="bg-blue-500 p-2 rounded-xl">
                            <Activity className="w-4 h-4 text-white" />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-white uppercase">Modo Offline Ativo</p>
                            <p className="text-[8px] text-blue-400/80 uppercase tracking-wider">Mapas visualizados são salvos para uso sem sinal</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                           <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1">Formato de Coordenada</label>
                           <div className="grid grid-cols-2 gap-2">
                             {['DMS', 'UTM'].map((fmt) => (
                               <button
                                 key={fmt}
                                 onClick={() => setAppState(prev => ({ ...prev, coordinateFormat: fmt as any }))}
                                 className={cn(
                                   "p-3 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition-all",
                                   appState.coordinateFormat === fmt ? "bg-blue-600 border-blue-500 text-white" : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                                 )}
                               >
                                 {fmt}
                               </button>
                             ))}
                           </div>
                        </div>

                        <div className="space-y-2">
                           <label className="text-[10px] font-bold text-zinc-400 uppercase ml-1">Unidade de Distância</label>
                           <div className="grid grid-cols-2 gap-2">
                             {[
                               { id: 'mt', label: 'METROS (mt)' },
                               { id: 'km', label: 'QUILÔMETROS (km)' }
                             ].map((unit) => (
                               <button
                                 key={unit.id}
                                 onClick={() => setAppState(prev => ({ ...prev, distanceUnit: unit.id as any }))}
                                 className={cn(
                                   "p-3 rounded-xl border text-[10px] font-bold uppercase tracking-widest transition-all text-center",
                                   appState.distanceUnit === unit.id ? "bg-blue-600 border-blue-500 text-white" : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                                 )}
                               >
                                 {unit.label}
                               </button>
                             ))}
                           </div>
                        </div>
                      </div>
                    </section>
                  </div>
                )}
              </div>
              
              <div className="p-6 border-t border-zinc-900 bg-zinc-950/50 backdrop-blur-md">
                 <div className="flex items-center gap-3 p-3 bg-zinc-900 rounded-xl border border-zinc-800">
                    <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">PM</div>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-white">PresidentMaps v1.0</p>
                      <p className="text-[9px] text-zinc-500">Professional Edition</p>
                    </div>
                    <button onClick={() => setActiveTab('settings')}>
                      <Settings className={cn("w-4 h-4 transition-colors", activeTab === 'settings' ? "text-blue-500" : "text-zinc-600 hover:text-zinc-300")} />
                    </button>
                 </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
