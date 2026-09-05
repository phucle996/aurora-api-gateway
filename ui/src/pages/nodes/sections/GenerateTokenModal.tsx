import React, { useState } from 'react';
import { Key, X, Copy, Check, Terminal, Shield } from 'lucide-react';

interface GenerateTokenModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GenerateTokenModal({ isOpen, onClose }: GenerateTokenModalProps) {
  const [role, setRole] = useState('Edge Node');
  const [ttl, setTtl] = useState('24 hours');
  const [tokenGenerated, setTokenGenerated] = useState(false);
  const [tokenString, setTokenString] = useState('');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    const rand = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    setTokenString(`awf_boot_${rand}`);
    setTokenGenerated(true);
  };

  const command = `aurora-waf join --controller https://waf-control.example.com --token ${tokenString || 'awf_boot_token_demo'}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-[#0B1320] border border-[#1C293D] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-[#152030] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-white font-mono">
              Generate Node Bootstrap Token
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white hover:bg-[#152030] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 font-mono text-xs">
          {!tokenGenerated ? (
            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="block text-slate-400 mb-1 text-[11px]">
                  Target Node Role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="Edge Node">Edge Node (Default)</option>
                  <option value="Ingress Controller">Ingress Controller</option>
                  <option value="Internal Gateway">Internal Gateway</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 text-[11px]">
                  Token Expiration (TTL)
                </label>
                <select
                  value={ttl}
                  onChange={(e) => setTtl(e.target.value)}
                  className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="1 hour">1 hour</option>
                  <option value="24 hours">24 hours (Recommended)</option>
                  <option value="7 days">7 days</option>
                </select>
              </div>

              <div className="p-3 bg-[#080E18] border border-[#152030] flex items-start gap-2.5 text-slate-400 font-sans text-xs">
                <Shield className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <p>
                  Tokens are single-use or cluster-scoped and establish an mTLS certificate exchange upon first contact.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#152030]">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-[#0E1726] border border-[#1C293D] text-slate-300 hover:text-white hover:bg-[#152030] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-white font-semibold transition-colors cursor-pointer"
                >
                  Generate Token
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="p-3 bg-emerald-950/40 border border-emerald-500/50 text-emerald-400 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>Bootstrap token generated successfully (Valid for {ttl}).</span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 text-[11px]">
                  Join Command for NGINX Node
                </label>
                <div className="relative p-3 bg-[#04070D] border border-[#1C293D] text-[11px] text-emerald-300 font-mono">
                  <pre className="whitespace-pre-wrap select-all">{command}</pre>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="absolute top-2.5 right-2.5 p-1 bg-[#152030] hover:bg-[#1C293D] text-slate-300 hover:text-white transition-colors cursor-pointer"
                    title="Copy command"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#152030]">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-white font-semibold transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
