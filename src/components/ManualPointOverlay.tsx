import React, { useState, useEffect } from 'react';
import { Save, X, Navigation, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { 
  dmsToDecimal, 
  decimalToDMS, 
  latLngToUTM, 
  utmToLatLng 
} from '../lib/coordinates';

interface ManualPointOverlayProps {
  lat: number;
  lng: number;
  onCoordinatesChange: (lat: number, lng: number) => void;
  onSave: (name: string, lat: number, lng: number) => void;
  onCancel: () => void;
}

type TabType = 'DMS' | 'UTM' | 'DEC';

export default function ManualPointOverlay({ 
  lat, 
  lng, 
  onCoordinatesChange, 
  onSave, 
  onCancel 
}: ManualPointOverlayProps) {
  const [name, setName] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('DMS');

  // DMS States
  const [latDeg, setLatDeg] = useState<number | ''>(0);
  const [latMin, setLatMin] = useState<number | ''>(0);
  const [latSec, setLatSec] = useState<number | ''>(0);
  const [latDir, setLatDir] = useState<'N' | 'S'>('S');

  const [lngDeg, setLngDeg] = useState<number | ''>(0);
  const [lngMin, setLngMin] = useState<number | ''>(0);
  const [lngSec, setLngSec] = useState<number | ''>(0);
  const [lngDir, setLngDir] = useState<'E' | 'W'>('W');

  // UTM States
  const [utmZoneNum, setUtmZoneNum] = useState<number | ''>(23);
  const [utmZoneLet, setUtmZoneLet] = useState('K');
  const [utmEasting, setUtmEasting] = useState<number | ''>(0);
  const [utmNorthing, setUtmNorthing] = useState<number | ''>(0);

  // Decimal States
  const [decLat, setDecLat] = useState('');
  const [decLng, setDecLng] = useState('');

  // Flag to prevent recursive updates
  const [isUpdatingFromMap, setIsUpdatingFromMap] = useState(false);

  // Keep track of the coordinates we just sent to prevent recursive resetting while typing
  const lastSentCoordsRef = React.useRef<{ lat: number; lng: number } | null>(null);

  // Sync state from Map click (i.e. props change)
  useEffect(() => {
    if (lastSentCoordsRef.current) {
      const { lat: lastLat, lng: lastLng } = lastSentCoordsRef.current;
      const diffLat = Math.abs(lat - lastLat);
      const diffLng = Math.abs(lng - lastLng);
      // If props changed but they match what we just sent (with high tolerance), do not overwrite local inputs
      if (diffLat < 0.000001 && diffLng < 0.000001) {
        return;
      }
    }

    setIsUpdatingFromMap(true);
    
    // Update DMS
    const dmsLat = decimalToDMS(lat, true);
    setLatDeg(dmsLat.degrees);
    setLatMin(dmsLat.minutes);
    setLatSec(dmsLat.seconds);
    setLatDir(dmsLat.direction as 'N' | 'S');

    const dmsLng = decimalToDMS(lng, false);
    setLngDeg(dmsLng.degrees);
    setLngMin(dmsLng.minutes);
    setLngSec(dmsLng.seconds);
    setLngDir(dmsLng.direction as 'E' | 'W');

    // Update UTM
    const utm = latLngToUTM(lat, lng);
    setUtmZoneNum(utm.zoneNumber);
    setUtmZoneLet(utm.zoneLetter);
    setUtmEasting(utm.easting);
    setUtmNorthing(utm.northing);

    // Update Decimal
    setDecLat(lat.toFixed(6));
    setDecLng(lng.toFixed(6));

    setTimeout(() => setIsUpdatingFromMap(false), 50);
  }, [lat, lng]);

  // Handle manual input change for DMS
  const handleDmsChange = (
    lDeg: number | '', lMin: number | '', lSec: number | '', lDir: 'N' | 'S',
    gDeg: number | '', gMin: number | '', gSec: number | '', gDir: 'E' | 'W'
  ) => {
    if (isUpdatingFromMap) return;
    const cleanLDeg = Number(lDeg) || 0;
    const cleanLMin = Number(lMin) || 0;
    const cleanLSec = Number(lSec) || 0;
    const cleanGDeg = Number(gDeg) || 0;
    const cleanGMin = Number(gMin) || 0;
    const cleanGSec = Number(gSec) || 0;
    const newLat = dmsToDecimal(cleanLDeg, cleanLMin, cleanLSec, lDir);
    const newLng = dmsToDecimal(cleanGDeg, cleanGMin, cleanGSec, gDir);
    if (!isNaN(newLat) && !isNaN(newLng)) {
      lastSentCoordsRef.current = { lat: newLat, lng: newLng };
      onCoordinatesChange(newLat, newLng);
    }
  };

  // Handle manual input change for UTM
  const handleUtmChange = (
    easting: number | '', northing: number | '', zoneNum: number | '', zoneLet: string
  ) => {
    if (isUpdatingFromMap) return;
    const cleanEasting = Number(easting) || 0;
    const cleanNorthing = Number(northing) || 0;
    const cleanZoneNum = Number(zoneNum) || 23;
    const converted = utmToLatLng(cleanEasting, cleanNorthing, cleanZoneNum, zoneLet);
    if (converted) {
      lastSentCoordsRef.current = { lat: converted.lat, lng: converted.lng };
      onCoordinatesChange(converted.lat, converted.lng);
    }
  };

  // Handle manual input change for Decimal
  const handleDecChange = (flat: string, flng: string) => {
    if (isUpdatingFromMap) return;
    const cleanLat = flat.replace(',', '.');
    const cleanLng = flng.replace(',', '.');
    const nLat = parseFloat(cleanLat);
    const nLng = parseFloat(cleanLng);
    if (!isNaN(nLat) && !isNaN(nLng)) {
      lastSentCoordsRef.current = { lat: nLat, lng: nLng };
      onCoordinatesChange(nLat, nLng);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(name.trim() || 'Ponto Sem Nome', lat, lng);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
      className="absolute bottom-0 left-0 right-0 md:left-1/2 md:-translate-x-1/2 w-full md:max-w-[480px] z-30 bg-zinc-950/98 border-t border-x border-zinc-900 rounded-t-2xl p-3 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex items-center justify-between mb-2.5 pb-1.5 border-b border-zinc-900">
        <div className="flex items-center gap-1.5 flex-1 min-w-0 pr-2">
          <Navigation className="w-3.5 h-3.5 text-emerald-500 animate-pulse flex-shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 leading-tight">
            Clique em qualquer local do mapa para mover o alfinete
          </span>
        </div>
        <button 
          onClick={onCancel}
          className="p-1 text-zinc-450 hover:text-red-500 hover:bg-zinc-900 rounded-lg transition-colors flex-shrink-0"
          title="Cancelar"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleFormSubmit} className="space-y-2.5">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-[8px] font-bold uppercase tracking-widest text-zinc-500 mb-0.5 block">Nome do Ponto</label>
            <input 
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Ponto de Coleta, Sede..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs text-white placeholder-zinc-650 focus:outline-none focus:border-blue-600 transition-colors"
            />
          </div>
          
          {/* Confirmation Buttons: Apenas Ícones */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onCancel}
              title="Cancelar"
              className="flex items-center justify-center p-2 px-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 rounded-xl transition-colors cursor-pointer h-8"
            >
              <X className="w-4 h-4" />
            </button>
            <button
              type="submit"
              title="Salvar"
              className="flex items-center justify-center p-2 px-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-600/10 transition-all cursor-pointer h-8"
            >
              <Save className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="grid grid-cols-3 gap-1 bg-zinc-900 p-0.5 rounded-xl border border-zinc-850/60">
          {(['DMS', 'UTM', 'DEC'] as TabType[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`py-1.5 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-colors ${
                activeTab === tab 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Contents */}
        {activeTab === 'DMS' && (
          <div className="space-y-3 pt-1">
            {/* Latitude DMS */}
            <div className="space-y-1">
              <span className="text-[8px] font-bold uppercase text-zinc-600 tracking-wider">Latitude</span>
              <div className="grid grid-cols-4 gap-1.5">
                <div>
                  <input
                    type="number"
                    value={latDeg}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed = parseInt(raw);
                      const v = raw === '' ? '' : (isNaN(parsed) ? 0 : Math.min(90, Math.max(0, parsed)));
                      setLatDeg(v);
                      handleDmsChange(v, latMin, latSec, latDir, lngDeg, lngMin, lngSec, lngDir);
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-center font-mono text-white focus:outline-none focus:border-blue-600"
                    placeholder="G"
                  />
                  <span className="text-[7px] text-zinc-600 block text-center mt-0.5 font-bold">Graus (°)</span>
                </div>
                <div>
                  <input
                    type="number"
                    value={latMin}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed = parseInt(raw);
                      const v = raw === '' ? '' : (isNaN(parsed) ? 0 : Math.min(59, Math.max(0, parsed)));
                      setLatMin(v);
                      handleDmsChange(latDeg, v, latSec, latDir, lngDeg, lngMin, lngSec, lngDir);
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-center font-mono text-white focus:outline-none focus:border-blue-600"
                    placeholder="M"
                  />
                  <span className="text-[7px] text-zinc-600 block text-center mt-0.5 font-bold">Min (')</span>
                </div>
                <div>
                  <input
                    type="number"
                    step="0.01"
                    value={latSec}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed = parseFloat(raw.replace(',', '.'));
                      const v = raw === '' ? '' : (isNaN(parsed) ? 0 : Math.min(59.99, Math.max(0, parsed)));
                      setLatSec(v);
                      handleDmsChange(latDeg, latMin, v, latDir, lngDeg, lngMin, lngSec, lngDir);
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-center font-mono text-white focus:outline-none focus:border-blue-600"
                    placeholder="S"
                  />
                  <span className="text-[7px] text-zinc-600 block text-center mt-0.5 font-bold">Seg (")</span>
                </div>
                <div>
                  <select
                    value={latDir}
                    onChange={(e) => {
                      const v = e.target.value as 'N' | 'S';
                      setLatDir(v);
                      handleDmsChange(latDeg, latMin, latSec, v, lngDeg, lngMin, lngSec, lngDir);
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-center font-mono text-white focus:outline-none focus:border-blue-600 appearance-none cursor-pointer"
                  >
                    <option value="N">N</option>
                    <option value="S">S</option>
                  </select>
                  <span className="text-[7px] text-zinc-600 block text-center mt-0.5 font-bold">Hemisf.</span>
                </div>
              </div>
            </div>

            {/* Longitude DMS */}
            <div className="space-y-1">
              <span className="text-[8px] font-bold uppercase text-zinc-600 tracking-wider">Longitude</span>
              <div className="grid grid-cols-4 gap-1.5">
                <div>
                  <input
                    type="number"
                    value={lngDeg}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed = parseInt(raw);
                      const v = raw === '' ? '' : (isNaN(parsed) ? 0 : Math.min(180, Math.max(0, parsed)));
                      setLngDeg(v);
                      handleDmsChange(latDeg, latMin, latSec, latDir, v, lngMin, lngSec, lngDir);
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-center font-mono text-white focus:outline-none focus:border-blue-600"
                    placeholder="G"
                  />
                  <span className="text-[7px] text-zinc-600 block text-center mt-0.5 font-bold">Graus (°)</span>
                </div>
                <div>
                  <input
                    type="number"
                    value={lngMin}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed = parseInt(raw);
                      const v = raw === '' ? '' : (isNaN(parsed) ? 0 : Math.min(59, Math.max(0, parsed)));
                      setLngMin(v);
                      handleDmsChange(latDeg, latMin, latSec, latDir, lngDeg, v, lngSec, lngDir);
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-center font-mono text-white focus:outline-none focus:border-blue-600"
                    placeholder="M"
                  />
                  <span className="text-[7px] text-zinc-600 block text-center mt-0.5 font-bold">Min (')</span>
                </div>
                <div>
                  <input
                    type="number"
                    step="0.01"
                    value={lngSec}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed = parseFloat(raw.replace(',', '.'));
                      const v = raw === '' ? '' : (isNaN(parsed) ? 0 : Math.min(59.99, Math.max(0, parsed)));
                      setLngSec(v);
                      handleDmsChange(latDeg, latMin, latSec, latDir, lngDeg, lngMin, v, lngDir);
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-center font-mono text-white focus:outline-none focus:border-blue-600"
                    placeholder="S"
                  />
                  <span className="text-[7px] text-zinc-600 block text-center mt-0.5 font-bold">Seg (")</span>
                </div>
                <div>
                  <select
                    value={lngDir}
                    onChange={(e) => {
                      const v = e.target.value as 'E' | 'W';
                      setLngDir(v);
                      handleDmsChange(latDeg, latMin, latSec, latDir, lngDeg, lngMin, lngSec, v);
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-1.5 text-[11px] text-center font-mono text-white focus:outline-none focus:border-blue-600 appearance-none cursor-pointer"
                  >
                    <option value="E">E</option>
                    <option value="W">W</option>
                  </select>
                  <span className="text-[7px] text-zinc-600 block text-center mt-0.5 font-bold">Hemisf.</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'UTM' && (
          <div className="grid grid-cols-2 gap-2 pt-1 font-mono">
            <div>
              <label className="text-[8px] font-bold uppercase text-zinc-600 block mb-0.5">Zona</label>
              <input
                type="number"
                value={utmZoneNum}
                onChange={(e) => {
                  const raw = e.target.value;
                  const parsed = parseInt(raw);
                  const v = raw === '' ? '' : (isNaN(parsed) ? 1 : Math.min(60, Math.max(1, parsed)));
                  setUtmZoneNum(v);
                  handleUtmChange(utmEasting, utmNorthing, v, utmZoneLet);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-[11px] text-white focus:outline-none focus:border-blue-600"
                placeholder="23"
              />
            </div>
            <div>
              <label className="text-[8px] font-bold uppercase text-zinc-600 block mb-0.5">Letra de Banda</label>
              <input
                type="text"
                maxLength={1}
                value={utmZoneLet}
                onChange={(e) => {
                  const v = e.target.value.toUpperCase();
                  setUtmZoneLet(v);
                  handleUtmChange(utmEasting, utmNorthing, utmZoneNum, v);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-[11px] text-center text-white font-bold focus:outline-none focus:border-blue-600"
                placeholder="K"
              />
            </div>
            <div className="col-span-2 grid grid-cols-2 gap-2">
              <div>
                <label className="text-[8px] font-bold uppercase text-zinc-600 block mb-0.5">Easting (E) - Metros</label>
                <input
                  type="number"
                  value={utmEasting}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const parsed = parseInt(raw);
                    const v = raw === '' ? '' : (isNaN(parsed) ? 0 : parsed);
                    setUtmEasting(v);
                    handleUtmChange(v, utmNorthing, utmZoneNum, utmZoneLet);
                  }}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-[11px] text-white focus:outline-none focus:border-blue-600"
                  placeholder="343200"
                />
              </div>
              <div>
                <label className="text-[8px] font-bold uppercase text-zinc-600 block mb-0.5">Northing (N) - Metros</label>
                <input
                  type="number"
                  value={utmNorthing}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const parsed = parseInt(raw);
                    const v = raw === '' ? '' : (isNaN(parsed) ? 0 : parsed);
                    setUtmNorthing(v);
                    handleUtmChange(utmEasting, v, utmZoneNum, utmZoneLet);
                  }}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-[11px] text-white focus:outline-none focus:border-blue-600"
                  placeholder="7456700"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'DEC' && (
          <div className="grid grid-cols-2 gap-2 pt-1 font-mono">
            <div>
              <label className="text-[8px] font-bold uppercase text-zinc-600 block mb-0.5">Latitude</label>
              <input
                type="text"
                value={decLat}
                onChange={(e) => {
                  setDecLat(e.target.value);
                  handleDecChange(e.target.value, decLng);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-[11px] text-white focus:outline-none focus:border-blue-600"
                placeholder="-23.550500"
              />
            </div>
            <div>
              <label className="text-[8px] font-bold uppercase text-zinc-600 block mb-0.5">Longitude</label>
              <input
                type="text"
                value={decLng}
                onChange={(e) => {
                  setDecLng(e.target.value);
                  handleDecChange(decLat, e.target.value);
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-[11px] text-white focus:outline-none focus:border-blue-600"
                placeholder="-46.633300"
              />
            </div>
          </div>
        )}

        {/* Fim do formulario compacto */}
      </form>
    </motion.div>
  );
}
