import React from 'react';
import {
  Monitor,
  Network,
  Globe,
  Building,
  Users,
  X,
  Plus,
} from 'lucide-react';

export type SourceType =
  | 'ip'
  | 'cidr'
  | 'country'
  | 'asn'
  | 'group';

interface IpSourceProps {
  sourceType: SourceType;
  setSourceType: (t: SourceType) => void;
  countries: string[];
  setCountries: React.Dispatch<React.SetStateAction<string[]>>;
  ipValue: string;
  setIpValue: (v: string) => void;
  cidrValue: string;
  setCidrValue: (v: string) => void;
  asnValue: string;
  setAsnValue: (v: string) => void;
  groupValue: string;
  setGroupValue: (v: string) => void;
}

export function IpSourceSection({
  sourceType,
  setSourceType,
  countries,
  setCountries,
  ipValue,
  setIpValue,
  cidrValue,
  setCidrValue,
  asnValue,
  setAsnValue,
  groupValue,
  setGroupValue,
}: IpSourceProps) {
  const tabs: Array<{ id: SourceType; label: string; icon: React.ReactNode }> = [
    { id: 'ip', label: 'IP Address', icon: <Monitor className="w-3.5 h-3.5" /> },
    { id: 'cidr', label: 'CIDR / Network', icon: <Network className="w-3.5 h-3.5" /> },
    { id: 'country', label: 'Country / Region', icon: <Globe className="w-3.5 h-3.5" /> },
    { id: 'asn', label: 'ASN', icon: <Building className="w-3.5 h-3.5" /> },
    { id: 'group', label: 'IP Group', icon: <Users className="w-3.5 h-3.5" /> },
  ];

  const handleToggleCountry = (code: string) => {
    if (countries.includes(code)) {
      setCountries(countries.filter((c) => c !== code));
    } else {
      setCountries([...countries, code]);
    }
  };

  const handleAddHighRisk = () => {
    const highRisk = ['RU', 'CN', 'KP', 'IR', 'SY', 'CU'];
    const merged = Array.from(new Set([...countries, ...highRisk]));
    setCountries(merged);
  };

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-4 font-mono text-xs">
      <div>
        <div className="text-sm font-semibold text-white">
          2. Source (IP / Network / Region)
        </div>
        <p className="text-slate-400 text-[11px] mt-0.5 font-sans">
          Define which IP addresses or networks this rule applies to.
        </p>
      </div>

      {/* Source Tabs */}
      <div className="flex border-b border-[#152030] bg-[#080E18] overflow-x-auto">
        {tabs.map((tab) => {
          const active = sourceType === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSourceType(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 transition-colors cursor-pointer whitespace-nowrap text-xs ${
                active
                  ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#0E1726]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Country / Region Subform */}
      {sourceType === 'country' && (
        <div className="space-y-3 pt-1">
          <div>
            <label className="block text-slate-400 mb-1.5 text-[11px]">
              Country / Region <span className="text-rose-400">*</span>
            </label>

            {/* Tagged input box */}
            <div className="p-2 bg-[#0E1726] border border-[#1C293D] flex flex-wrap items-center gap-1.5 min-h-[38px]">
              {countries.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#152030] border border-[#1C293D] text-slate-200 text-xs font-mono"
                >
                  <span>{c}</span>
                  <button
                    type="button"
                    onClick={() => handleToggleCountry(c)}
                    className="text-slate-400 hover:text-rose-400 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}

              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleToggleCountry(e.target.value);
                    e.target.value = '';
                  }
                }}
                defaultValue=""
                className="bg-transparent text-slate-400 text-xs font-mono focus:outline-none cursor-pointer pl-1"
              >
                <option value="" disabled>+ Add country...</option>
                <option value="RU">Russia (RU)</option>
                <option value="CN">China (CN)</option>
                <option value="KP">North Korea (KP)</option>
                <option value="IR">Iran (IR)</option>
                <option value="SY">Syria (SY)</option>
                <option value="US">United States (US)</option>
                <option value="VN">Vietnam (VN)</option>
                <option value="DE">Germany (DE)</option>
                <option value="JP">Japan (JP)</option>
              </select>
            </div>
          </div>

          {/* Quick Select Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500 text-[11px] mr-1">Quick Select:</span>
              <button
                type="button"
                onClick={() => handleToggleCountry('RU')}
                className={`px-2 py-1 border text-xs cursor-pointer transition-colors ${
                  countries.includes('RU')
                    ? 'bg-blue-950/60 border-blue-500/50 text-cyan-300'
                    : 'bg-[#0E1726] border-[#1C293D] text-slate-300 hover:bg-[#152030]'
                }`}
              >
                Russia (RU)
              </button>

              <button
                type="button"
                onClick={() => handleToggleCountry('CN')}
                className={`px-2 py-1 border text-xs cursor-pointer transition-colors ${
                  countries.includes('CN')
                    ? 'bg-blue-950/60 border-blue-500/50 text-cyan-300'
                    : 'bg-[#0E1726] border-[#1C293D] text-slate-300 hover:bg-[#152030]'
                }`}
              >
                China (CN)
              </button>

              <button
                type="button"
                onClick={() => handleToggleCountry('KP')}
                className={`px-2 py-1 border text-xs cursor-pointer transition-colors ${
                  countries.includes('KP')
                    ? 'bg-blue-950/60 border-blue-500/50 text-cyan-300'
                    : 'bg-[#0E1726] border-[#1C293D] text-slate-300 hover:bg-[#152030]'
                }`}
              >
                North Korea (KP)
              </button>

              <button
                type="button"
                onClick={() => handleToggleCountry('IR')}
                className={`px-2 py-1 border text-xs cursor-pointer transition-colors ${
                  countries.includes('IR')
                    ? 'bg-blue-950/60 border-blue-500/50 text-cyan-300'
                    : 'bg-[#0E1726] border-[#1C293D] text-slate-300 hover:bg-[#152030]'
                }`}
              >
                Iran (IR)
              </button>

              <button
                type="button"
                onClick={handleAddHighRisk}
                className="px-2.5 py-1 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-amber-400 text-xs cursor-pointer transition-colors"
              >
                High Risk Countries
              </button>
            </div>

            <button
              type="button"
              onClick={() => setCountries([])}
              className="px-2.5 py-1 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-400 hover:text-white text-xs cursor-pointer transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* IP Address Subform */}
      {sourceType === 'ip' && (
        <div className="space-y-2 pt-1">
          <label className="block text-slate-400 mb-1 text-[11px]">
            Target IP Address <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            value={ipValue}
            onChange={(e) => setIpValue(e.target.value)}
            placeholder="e.g. 203.0.113.10"
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
        </div>
      )}

      {/* CIDR Subform */}
      {sourceType === 'cidr' && (
        <div className="space-y-2 pt-1">
          <label className="block text-slate-400 mb-1 text-[11px]">
            CIDR Network Block <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            value={cidrValue}
            onChange={(e) => setCidrValue(e.target.value)}
            placeholder="e.g. 198.51.100.0/24 or 10.0.0.0/8"
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
        </div>
      )}

      {/* ASN Subform */}
      {sourceType === 'asn' && (
        <div className="space-y-2 pt-1">
          <label className="block text-slate-400 mb-1 text-[11px]">
            Autonomous System Number (ASN) <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            value={asnValue}
            onChange={(e) => setAsnValue(e.target.value)}
            placeholder="e.g. AS13335 (Cloudflare) or AS15169 (Google)"
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
        </div>
      )}

      {/* IP Group Subform */}
      {sourceType === 'group' && (
        <div className="space-y-2 pt-1">
          <label className="block text-slate-400 mb-1 text-[11px]">
            IP Group Name <span className="text-rose-400">*</span>
          </label>
          <select
            value={groupValue}
            onChange={(e) => setGroupValue(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            <option value="trusted-partners">trusted-partners (12 CIDRs)</option>
            <option value="internal-gateways">internal-gateways (8 CIDRs)</option>
            <option value="crawler-bot-pool">crawler-bot-pool (45 IPs)</option>
          </select>
        </div>
      )}
    </div>
  );
}
