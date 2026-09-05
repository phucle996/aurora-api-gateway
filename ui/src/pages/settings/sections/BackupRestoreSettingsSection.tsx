import React, { useState } from 'react';
import { Database, Download, Upload, Folder, Check, AlertCircle } from 'lucide-react';

export function BackupRestoreSettingsSection() {
  const [autoBackup, setAutoBackup] = useState(true);
  const [backupInterval, setBackupInterval] = useState('Daily');
  const [retention, setRetention] = useState('30 days');
  const [backupLocation, setBackupLocation] = useState('/var/lib/aurora/backup');
  const [backingUp, setBackingUp] = useState(false);
  const [backupSuccess, setBackupSuccess] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const handleBackupNow = () => {
    setBackingUp(true);
    setTimeout(() => {
      setBackingUp(false);
      setBackupSuccess(true);
      setTimeout(() => setBackupSuccess(false), 3000);
    }, 800);
  };

  const handleRestore = () => {
    if (window.confirm('Are you sure you want to restore from the latest snapshot? Current runtime state will be reloaded.')) {
      setRestoring(true);
      setTimeout(() => {
        setRestoring(false);
        alert('Cluster state restored successfully.');
      }, 1000);
    }
  };

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-2 pb-3 border-b border-[#152030] text-sm font-semibold text-white font-mono">
          <Database className="w-4 h-4 text-emerald-400" />
          <span>Backup & Restore</span>
        </div>

        <div className="mt-3 space-y-3 text-xs font-mono">
          {/* Auto Backup */}
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Auto Backup</span>
            <button
              type="button"
              onClick={() => setAutoBackup(!autoBackup)}
              className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                autoBackup ? 'bg-emerald-600' : 'bg-[#152030]'
              }`}
            >
              <div
                className={`w-4 h-4 bg-white transition-transform ${
                  autoBackup ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Backup Interval */}
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Backup Interval</span>
            <select
              value={backupInterval}
              onChange={(e) => setBackupInterval(e.target.value)}
              className="bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="Hourly">Hourly</option>
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </div>

          {/* Retention */}
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Retention</span>
            <select
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
              className="bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-slate-200 text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="7 days">7 days</option>
              <option value="14 days">14 days</option>
              <option value="30 days">30 days</option>
              <option value="90 days">90 days</option>
              <option value="365 days">365 days</option>
            </select>
          </div>

          {/* Backup Location */}
          <div className="space-y-1 pt-1">
            <span className="text-slate-400 block">Backup Location</span>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={backupLocation}
                onChange={(e) => setBackupLocation(e.target.value)}
                className="flex-1 bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                className="p-1.5 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-400 hover:text-white cursor-pointer"
                title="Browse folder"
              >
                <Folder className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-2 pt-2 border-t border-[#152030]/60">
            <button
              type="button"
              onClick={handleBackupNow}
              disabled={backingUp}
              className="w-full flex items-center justify-center gap-2 py-2 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-200 hover:text-white text-xs font-mono transition-colors cursor-pointer"
            >
              {backingUp ? (
                <span>Snapshotting database...</span>
              ) : backupSuccess ? (
                <span className="text-emerald-400 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> Snapshot Saved!
                </span>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                  <span>Backup Now</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleRestore}
              disabled={restoring}
              className="w-full flex items-center justify-center gap-2 py-2 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-300 hover:text-white text-xs font-mono transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-slate-400" />
              <span>{restoring ? 'Restoring...' : 'Restore from Backup'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
