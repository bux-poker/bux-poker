import React from 'react';
import type { Player } from '@shared/types/game';

interface PlayerStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  player: Player | null;
}

export default function PlayerStatsModal({ isOpen, onClose, player }: PlayerStatsModalProps) {
  if (!isOpen || !player) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div 
        className="rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-xl max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-slate-100">
            {player.name}'s Stats
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors"
          >
            ✕
          </button>
        </div>
        
        <div className="space-y-3">
          <div>
            <span className="text-sm text-slate-400">Name:</span>
            <p className="text-slate-200">{player.name}</p>
          </div>
          
          {player.chips !== undefined && (
            <div>
              <span className="text-sm text-slate-400">Chips:</span>
              <p className="text-slate-200">{player.chips.toLocaleString()}</p>
            </div>
          )}
          
          {player.status && (
            <div>
              <span className="text-sm text-slate-400">Status:</span>
              <p className="text-slate-200">{player.status}</p>
            </div>
          )}
          
          {player.seatNumber !== undefined && (
            <div>
              <span className="text-sm text-slate-400">Seat:</span>
              <p className="text-slate-200">{player.seatNumber}</p>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
