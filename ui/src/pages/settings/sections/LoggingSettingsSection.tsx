import React, { useState } from 'react';
import { FileText, ScrollText } from 'lucide-react';

export function LoggingSettingsSection() {
  const [logLevel, setLogLevel] = useState('Info');
  const [logRetention, setLogRetention] = useState('30 days');
  const [maxLogSize, setMaxLogSize] = useState('1 GB');
  const [enableAccessLog, setEnableAccessLog] = useState(true);
  const [enableAuditLog, setEnableAuditLog] = useState(true);
  const [enableErrorLog, setEnableErrorLog] = useState(true);
  const [remoteSyslog, setRemoteSyslog] = useState(false);

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs">
      <div>
        <div className="flex items-center gap-2 pb-3 border-b border-border text-sm font-semibold text-foreground">
          <FileText className="w-4 h-4 text-primary" />
          <span>Logging</span>
        </div>

        <div className="mt-3 space-y-3 text-xs">
          {/* Log Level */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Log Level</span>
            <select
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value)}
              className="bg-background border border-input px-2.5 py-1 text-foreground text-xs focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="Debug">Debug</option>
              <option value="Info">Info</option>
              <option value="Warn">Warn</option>
              <option value="Error">Error</option>
            </select>
          </div>

          {/* Log Retention */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Log Retention</span>
            <select
              value={logRetention}
              onChange={(e) => setLogRetention(e.target.value)}
              className="bg-background border border-input px-2.5 py-1 text-foreground text-xs focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="7 days">7 days</option>
              <option value="14 days">14 days</option>
              <option value="30 days">30 days</option>
              <option value="90 days">90 days</option>
              <option value="365 days">365 days</option>
            </select>
          </div>

          {/* Max Log Size */}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Max Log Size</span>
            <select
              value={maxLogSize}
              onChange={(e) => setMaxLogSize(e.target.value)}
              className="bg-background border border-input px-2.5 py-1 text-foreground text-xs focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="250 MB">250 MB</option>
              <option value="500 MB">500 MB</option>
              <option value="1 GB">1 GB</option>
              <option value="5 GB">5 GB</option>
            </select>
          </div>

          <div className="pt-2 border-t border-border space-y-2.5">
            {/* Enable Access Log */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Enable Access Log</span>
              <button
                type="button"
                onClick={() => setEnableAccessLog(!enableAccessLog)}
                className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${enableAccessLog ? 'bg-primary' : 'bg-muted border border-border'
                  }`}
              >
                <div
                  className={`w-4 h-4 bg-white transition-transform ${enableAccessLog ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>

            {/* Enable Audit Log */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Enable Audit Log</span>
              <button
                type="button"
                onClick={() => setEnableAuditLog(!enableAuditLog)}
                className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${enableAuditLog ? 'bg-primary' : 'bg-muted border border-border'
                  }`}
              >
                <div
                  className={`w-4 h-4 bg-white transition-transform ${enableAuditLog ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>

            {/* Enable Error Log */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Enable Error Log</span>
              <button
                type="button"
                onClick={() => setEnableErrorLog(!enableErrorLog)}
                className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${enableErrorLog ? 'bg-primary' : 'bg-muted border border-border'
                  }`}
              >
                <div
                  className={`w-4 h-4 bg-white transition-transform ${enableErrorLog ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>

            {/* Remote Syslog */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Remote Syslog</span>
              <button
                type="button"
                onClick={() => setRemoteSyslog(!remoteSyslog)}
                className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${remoteSyslog ? 'bg-primary' : 'bg-muted border border-border'
                  }`}
              >
                <div
                  className={`w-4 h-4 bg-white transition-transform ${remoteSyslog ? 'translate-x-4' : 'translate-x-0'
                    }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
