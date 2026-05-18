import React, { useState } from 'react';
import { X, Save, MapPin } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { POI } from '../types';
import { cn } from '../lib/utils';

interface POIDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (poi: Omit<POI, 'id' | 'createdAt'>) => void;
  lat: number;
  lng: number;
  initialData?: POI;
}

export default function POIDialog({ isOpen, onClose, onSave, lat, lng, initialData }: POIDialogProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [color, setColor] = useState(initialData?.color || '#3b82f6');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    onSave({ name, description, color, lat, lng });
    setName('');
    setDescription('');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-zinc-950 border border-zinc-800 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-zinc-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5 text-blue-500" />
                <h2 className="text-lg font-bold text-white">Novo Marcador</h2>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-zinc-900 rounded-xl transition-colors">
                <X className="w-5 h-5 text-zinc-500" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Localização</label>
                <div className="grid grid-cols-2 gap-2 font-mono text-xs text-blue-400 bg-blue-500/5 p-3 rounded-xl border border-blue-500/20">
                  <span>LAT: {lat.toFixed(6)}</span>
                  <span>LNG: {lng.toFixed(6)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Nome do Local</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Minha Casa, Base, Ponto de Coleta..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-600 transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Descrição</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Informações adicionais sobre este ponto..."
                  rows={3}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-600 transition-colors resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Cor do Marcador</label>
                <div className="flex gap-2">
                  {['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ffffff'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={cn(
                        "w-8 h-8 rounded-full border-2 transition-all",
                        color === c ? "border-white scale-110 shadow-lg" : "border-transparent opacity-60 hover:opacity-100"
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={!name}
                className="w-full flex items-center justify-center gap-2 p-4 bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold rounded-2xl hover:bg-blue-500 transition-colors mt-4"
              >
                <Save className="w-5 h-5" />
                Salvar Ponto
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
