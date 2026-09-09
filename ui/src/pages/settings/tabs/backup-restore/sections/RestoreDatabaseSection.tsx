import React, { useState, useRef } from 'react';
import { Upload, FileText, Trash2, Database, Loader2 } from 'lucide-react';
import { backupApi } from '../../../../../lib/api';

interface RestoreDatabaseSectionProps {
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onRestoreCompleted: () => void;
}

export function RestoreDatabaseSection({
  onError,
  onSuccess,
  onRestoreCompleted,
}: RestoreDatabaseSectionProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag & Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      validateAndSelectFile(file);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      validateAndSelectFile(file);
    }
  };

  const validateAndSelectFile = (file: File) => {
    const validExts = ['.db', '.sqlite', '.sqlite3', '.sql', '.gz', '.tar.gz'];
    const fileName = file.name.toLowerCase();
    const isValid = validExts.some((ext) => fileName.endsWith(ext));

    if (!isValid) {
      onError('Định dạng file không hỗ trợ. Vui lòng chọn file database (.db, .sqlite, .sql, .tar.gz)');
      return;
    }

    setSelectedFile(file);
    setConfirmRestore(false);
    onError('');
  };

  // Restore Execution Action
  const handleExecuteRestore = async () => {
    if (!selectedFile) return;
    if (!confirmRestore) {
      onError('Vui lòng tích xác nhận ghi đè cơ sở dữ liệu trước khi phục hồi.');
      return;
    }

    setRestoring(true);
    onError('');

    try {
      const res = await backupApi.restoreSnapshot(selectedFile);
      onSuccess(res.message || 'Phục hồi cơ sở dữ liệu thành công!');
      setSelectedFile(null);
      setConfirmRestore(false);
      onRestoreCompleted();
    } catch (err: any) {
      onError(err?.message || 'Lỗi phục hồi snapshot database');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="pt-2 border-t border-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-foreground">
            Restore Database Snapshot (Drag & Drop or Upload)
          </span>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Supports .db, .sqlite, .sql, .tar.gz snapshots
        </span>
      </div>

      {/* Hidden native input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".db,.sqlite,.sqlite3,.sql,.gz,.tar.gz"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-all cursor-pointer ${
          dragActive
            ? 'border-primary bg-primary/10 shadow-md scale-[1.01]'
            : selectedFile
            ? 'border-emerald-500/50 bg-emerald-500/5'
            : 'border-border hover:border-primary/50 hover:bg-muted/30 bg-background'
        }`}
      >
        <div className="flex flex-col items-center justify-center space-y-2">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Upload className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-medium text-foreground">
              Drag & drop your backup database file here, or{' '}
              <span className="text-primary underline">browse from your computer</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Valid SQLite snapshots (.db, .sqlite) will be inspected for schema integrity before applying.
            </p>
          </div>
        </div>
      </div>

      {/* Selected File Card & Confirmation */}
      {selectedFile && (
        <div className="p-3.5 border border-border rounded-lg bg-background space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <FileText className="w-4 h-4 text-primary" />
              <div>
                <div className="font-semibold text-foreground text-xs flex items-center gap-2">
                  <span>{selectedFile.name}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-muted text-muted-foreground font-mono">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground">Ready for integrity verification & restore</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors cursor-pointer"
              title="Remove selected file"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="pt-2 border-t border-border flex items-center justify-between gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmRestore}
                onChange={(e) => setConfirmRestore(e.target.checked)}
                className="h-4 w-4 rounded border-input text-destructive focus:ring-destructive cursor-pointer"
              />
              <span className="text-[11px] text-destructive font-medium">
                I confirm that restoring this snapshot will reload current system configuration.
              </span>
            </label>

            <button
              type="button"
              disabled={restoring || !confirmRestore}
              onClick={handleExecuteRestore}
              className={`px-3.5 py-1.5 rounded text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 ${
                confirmRestore
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-xs'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              }`}
            >
              {restoring ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Restoring Database...</span>
                </>
              ) : (
                <>
                  <Database className="w-3.5 h-3.5" />
                  <span>Execute Restore</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
