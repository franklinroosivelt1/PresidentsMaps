import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check } from 'lucide-react';
import UtmConverter from 'utm-latlng';

interface CoordinatePanelProps {
  lat: number;
  lng: number;
  format?: 'DMS' | 'UTM';
}

const utmObj = new UtmConverter();

function toGMS(coord: number, isLat: boolean): string {
  const absolute = Math.abs(coord);
  const degrees = Math.floor(absolute);
  const minutesNotTruncated = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesNotTruncated);
  const seconds = ((minutesNotTruncated - minutes) * 60).toFixed(2);
  const direction = isLat 
    ? (coord >= 0 ? 'N' : 'S') 
    : (coord >= 0 ? 'E' : 'W');
  return `${degrees}° ${minutes}' ${seconds}" ${direction}`;
}

export default function CoordinatePanel({ lat, lng, format = 'DMS' }: CoordinatePanelProps) {
  const [copied, setCopied] = useState(false);

  const getDisplayCoords = () => {
    if (format === 'UTM') {
      try {
        const utm = utmObj.ConvertLatLngToUtm(lat, lng, 1) as any;
        return `${utm.ZoneNumber}${utm.ZoneLetter} ${utm.Easting.toFixed(0)}m E ${utm.Northing.toFixed(0)}m N`;
      } catch (e) {
        return "Erro UTM";
      }
    }
    return `${toGMS(lat, true)}, ${toGMS(lng, false)}`;
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(getDisplayCoords());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div 
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 group"
    >
      <button
        onClick={copyToClipboard}
        className="bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 px-3 py-1.5 rounded-full shadow-2xl flex items-center gap-2 min-w-max transition-all hover:bg-zinc-800/80 active:scale-95 cursor-pointer relative overflow-hidden group"
      >
        <AnimatePresence>
          {copied && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute inset-0 bg-blue-600 flex items-center justify-center gap-1.5 text-white font-bold text-[9px] uppercase tracking-widest z-10"
            >
              <Check className="w-2.5 h-2.5" /> Copiado!
            </motion.div>
          )}
        </AnimatePresence>

        <span className="text-[7px] uppercase font-bold tracking-[0.2em] text-zinc-500 border-r border-zinc-800 pr-2">{format}</span>
        <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-white tabular-nums tracking-tight whitespace-nowrap">
          {getDisplayCoords()}
        </div>
      </button>
    </motion.div>
  );
}
