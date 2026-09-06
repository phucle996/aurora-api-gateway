import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, AlertOctagon } from 'lucide-react';

export function DangerZoneSection() {
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const handleReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmInput === 'RESET-AURORA') {
      setIsResetting(true);
      setTimeout(() => {
        setIsResetting(false);
        setShowConfirmModal(false);
        setConfirmInput('');
        alert('Cluster preferences reset to factory defaults.');
      }, 800);
    }
  };

  return (
    <>
      <div className="bg-white dark:bg-[#0B1320] border border-rose-200 dark:border-rose-950/60 p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-500/40 text-rose-600 dark:text-rose-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white font-mono">
              Danger Zone
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
              These actions are irreversible. Please proceed with caution.
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowConfirmModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 border border-rose-500 text-white text-xs font-semibold font-mono transition-colors cursor-pointer shrink-0"
        >
          <Trash2 className="w-4 h-4" />
          <span>Reset to Factory Defaults</span>
        </button>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-[#0B1320] border border-rose-300 dark:border-rose-500/60 shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-[#152030] flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
                <AlertOctagon className="w-4 h-4" />
                <h3 className="text-sm font-semibold font-mono">Confirm Factory Reset</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleReset} className="p-5 space-y-4 font-mono text-xs">
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-sans">
                This will wipe all active rulesets, policy groups, node tokens, and revert all configuration to initial bootstrap settings.
              </p>

              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1 text-[11px]">
                  Type <span className="text-rose-600 dark:text-rose-400 font-bold">RESET-AURORA</span> to confirm:
                </label>
                <input
                  type="text"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder="RESET-AURORA"
                  className="w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-300 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white font-mono focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-[#152030]">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={confirmInput !== 'RESET-AURORA' || isResetting}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 border border-rose-500 text-white font-semibold cursor-pointer"
                >
                  {isResetting ? 'Resetting...' : 'Confirm Reset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
