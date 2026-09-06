import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Globe,
  Server,
  Shield,
  FileText,
  Plus,
  Search,
  Check,
  ChevronDown,
  X,
  ExternalLink,
  Lock,
  Zap,
  Activity,
  AlertCircle,
  Code,
} from 'lucide-react';
import type { DomainItem, TlsType } from '../domains/types';
import { policiesApi, type SavedPolicy } from '../../lib/api/policies';
import type { UpstreamItem } from '../upstreams/types';
import { INITIAL_UPSTREAMS } from '../upstreams/mockData';

export default function CreateDomainPage() {
  const navigate = useNavigate();

  // 1. Basic Information
  const [domainName, setDomainName] = useState('');
  const [rootDomain, setRootDomain] = useState('');
  const [description, setDescription] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // 2. Target Upstream (NGINX ➔ Backend)
  const [availableUpstreams, setAvailableUpstreams] = useState<UpstreamItem[]>([]);
  const [upstreamMode, setUpstreamMode] = useState<'pool' | 'direct'>('pool');
  const [selectedUpstreamId, setSelectedUpstreamId] = useState<string>('');
  const [directAddress, setDirectAddress] = useState('127.0.0.1:8080');
  const [directProtocol, setDirectProtocol] = useState<'http://' | 'https://'>('http://');

  // Load upstreams from storage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('aurora_waf_upstreams');
      if (saved) {
        const parsed = JSON.parse(saved);
        setAvailableUpstreams(parsed);
        if (parsed.length > 0) {
          setSelectedUpstreamId(parsed[0].id);
        }
      } else {
        setAvailableUpstreams(INITIAL_UPSTREAMS);
        if (INITIAL_UPSTREAMS.length > 0) {
          setSelectedUpstreamId(INITIAL_UPSTREAMS[0].id);
        }
      }
    } catch {
      setAvailableUpstreams(INITIAL_UPSTREAMS);
      if (INITIAL_UPSTREAMS.length > 0) {
        setSelectedUpstreamId(INITIAL_UPSTREAMS[0].id);
      }
    }
  }, []);

  const selectedUpstream = availableUpstreams.find((u) => u.id === selectedUpstreamId) || availableUpstreams[0];

  // 3. Edge TLS / Security (Client ➔ NGINX)
  const [tlsMode, setTlsMode] = useState<TlsType>("Let's Encrypt");
  const [certificateEmail, setCertificateEmail] = useState('');
  const [tlsVersion, setTlsVersion] = useState<'TLS 1.2' | 'TLS 1.3'>('TLS 1.2');
  const [hstsEnabled, setHstsEnabled] = useState(true);
  const [additionalSans, setAdditionalSans] = useState('');

  // 4. Edge WAF & Policy Binding (Client Ingress)
  const [availablePolicies, setAvailablePolicies] = useState<SavedPolicy[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<number[]>([]);
  const [policyDropdownOpen, setPolicyDropdownOpen] = useState(false);
  const [policySearch, setPolicySearch] = useState('');
  const [enableWaf, setEnableWaf] = useState(true);
  const [enableRateLimiting, setEnableRateLimiting] = useState(true);

  // Load policies
  useEffect(() => {
    policiesApi.list()
      .then((rows) => setAvailablePolicies(rows))
      .catch(() => {
        setAvailablePolicies([]);
      });
  }, []);

  // Auto-fill root domain when domain changes
  const handleDomainChange = (val: string) => {
    setDomainName(val);
    const trimmed = val.trim();
    const parts = trimmed.split('.');
    if (parts.length >= 2) {
      setRootDomain(parts.slice(-2).join('.'));
    } else {
      setRootDomain(trimmed);
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = tagInput.trim().replace(/^,+|,+$/g, '');
      if (val && !tags.includes(val)) {
        setTags([...tags, val]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainName.trim()) return;

    let currentDomains: DomainItem[] = [];
    try {
      const saved = localStorage.getItem('aurora_waf_domains');
      if (saved) currentDomains = JSON.parse(saved);
    } catch {
      // ignore
    }

    let upstreamDisplayName = '';
    let upstreamServersList: Array<{ url: string; weight: number; maxFails: number; failTimeout: string; healthy: boolean }> = [];
    let algorithm: 'round_robin' | 'least_conn' | 'ip_hash' = 'round_robin';
    let healthPath = '/health';
    let httpVer: 'HTTP/1.1' | 'HTTP/2' | 'HTTP/3' | 'HTTP/1.0' = 'HTTP/1.1';
    let ws = false;
    let sse = false;
    let grpc = false;

    if (upstreamMode === 'pool' && selectedUpstream) {
      upstreamDisplayName = selectedUpstream.name;
      algorithm = selectedUpstream.algorithm;
      upstreamServersList = selectedUpstream.servers.map((s) => ({
        url: s.address.startsWith('http://') || s.address.startsWith('https://')
          ? s.address
          : `${selectedUpstream.internalSsl?.enabled ? 'https://' : 'http://'}${s.address}`,
        weight: s.weight || 1,
        maxFails: s.maxFails || 3,
        failTimeout: s.failTimeout || '10s',
        healthy: s.healthy,
      }));
      healthPath = selectedUpstream.probes?.[0]?.path || '/health';
      httpVer = selectedUpstream.transport?.httpVersion || 'HTTP/1.1';
      ws = !!selectedUpstream.transport?.enableWebSocket;
      sse = !!selectedUpstream.transport?.enableSse;
      grpc = !!selectedUpstream.transport?.enableGrpc;
    } else {
      const addr = directAddress.trim() || '127.0.0.1:8080';
      const full = addr.startsWith('http://') || addr.startsWith('https://') ? addr : `${directProtocol}${addr}`;
      upstreamDisplayName = full;
      upstreamServersList = [
        { url: full, weight: 1, maxFails: 3, failTimeout: '10s', healthy: true },
      ];
    }

    const newDomain: DomainItem = {
      id: `dom-${Date.now()}`,
      domain: domainName.trim(),
      rootDomain: rootDomain.trim() || domainName.trim(),
      status: 'Active',
      tlsType: tlsMode,
      tlsExpiry: '2026-03-07',
      tlsAutoRenew: true,
      minTlsVersion: tlsVersion === 'TLS 1.3' ? 'TLSv1.3' : 'TLSv1.2',
      hstsEnabled,
      upstream: upstreamDisplayName,
      upstreamAlgorithm: algorithm,
      healthCheckPath: healthPath,
      upstreamServers: upstreamServersList,
      rulesCount: enableWaf ? 4 : 0,
      policiesCount: selectedPolicies.length,
      ipRulesCount: 0,
      rateLimitsCount: enableRateLimiting ? 2 : 0,
      tags,
      httpVersion: httpVer,
      enableWebSocket: ws,
      enableSse: sse,
      enableGrpc: grpc,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      createdBy: 'admin',
      description: description.trim(),
    };

    const updated = [newDomain, ...currentDomains];
    try {
      localStorage.setItem('aurora_waf_domains', JSON.stringify(updated));
    } catch {
      // ignore
    }

    navigate('/domains');
  };

  return (
    <div className="p-4 sm:p-6 w-full space-y-6 pb-16 font-sans min-w-0">
      {/* Top Header */}
      <div className="flex flex-col gap-2">
        <Link
          to="/domains"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Domains
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Add Domain</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure edge domain entry point, bind target upstream pool, setup edge SSL, and apply WAF policies.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleCreate}>
        <div className="grid grid-cols-12 gap-6 items-start">
          {/* Main Form Fields */}
          <div className="col-span-12 lg:col-span-8 space-y-6">
            {/* 1. Basic Information */}
            <div className="bg-card border border-border rounded-xl p-5 sm:p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 pb-3 border-b border-border">
                <Globe className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-card-foreground">1. Edge Domain Identification</h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground">
                    Domain Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. app.example.com"
                    value={domainName}
                    onChange={(e) => handleDomainChange(e.target.value)}
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">The public FQDN requested by client browsers.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-foreground">
                    Root Domain <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. example.com"
                    value={rootDomain}
                    onChange={(e) => setRootDomain(e.target.value)}
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">Base apex domain used for certificate verification.</p>
                </div>

                <div className="col-span-full space-y-1.5">
                  <label className="block text-xs font-medium text-foreground">
                    Description <span className="text-muted-foreground font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Customer Portal & API gateway"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="col-span-full space-y-1.5">
                  <label className="block text-xs font-medium text-foreground">
                    Tags
                  </label>
                  <input
                    type="text"
                    placeholder="Type tag and press Enter..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {tags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary border border-primary/25"
                        >
                          <span>{t}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(t)}
                            className="hover:opacity-75 cursor-pointer ml-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Target Upstream (NGINX ➔ Backend) */}
            <div className="bg-card border border-border rounded-xl p-5 sm:p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-primary" />
                  <div>
                    <h2 className="text-sm font-semibold text-card-foreground">2. Target Upstream (NGINX ➔ Backend)</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Select the backend server pool or service origin to receive forwarded traffic.
                    </p>
                  </div>
                </div>
                <Link
                  to="/upstreams/create"
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary hover:text-primary/80 bg-primary/10 border border-primary/20 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Upstream Pool
                </Link>
              </div>

              {/* Mode switch */}
              <div className="flex items-center gap-4 text-xs">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="upstreamMode"
                    value="pool"
                    checked={upstreamMode === 'pool'}
                    onChange={() => setUpstreamMode('pool')}
                    className="w-3.5 h-3.5 text-primary bg-background border-input focus:ring-ring"
                  />
                  <span className={upstreamMode === 'pool' ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                    Configured Upstream Pool (Recommended)
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="upstreamMode"
                    value="direct"
                    checked={upstreamMode === 'direct'}
                    onChange={() => setUpstreamMode('direct')}
                    className="w-3.5 h-3.5 text-primary bg-background border-input focus:ring-ring"
                  />
                  <span className={upstreamMode === 'direct' ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                    Direct Address (Quick Single Host)
                  </span>
                </label>
              </div>

              {upstreamMode === 'pool' ? (
                <div className="space-y-4 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      Select Upstream Pool <span className="text-destructive">*</span>
                    </label>
                    <select
                      value={selectedUpstreamId}
                      onChange={(e) => setSelectedUpstreamId(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-medium"
                    >
                      {availableUpstreams.map((ups) => (
                        <option key={ups.id} value={ups.id}>
                          {ups.name} ({ups.type} — {ups.servers.length} {ups.servers.length === 1 ? 'node' : 'nodes'})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedUpstream && (
                    <div className="p-4 bg-muted/30 border border-border rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-foreground font-mono">{selectedUpstream.name}</span>
                          <span className="px-2 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 rounded">
                            {selectedUpstream.type}
                          </span>
                        </div>
                        <Link
                          to="/upstreams"
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Manage Upstreams <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div className="p-2.5 bg-background/60 rounded border border-border space-y-1">
                          <span className="text-[11px] text-muted-foreground block">Nodes Pool & Algorithm</span>
                          <span className="font-medium text-foreground block">
                            {selectedUpstream.servers.length} nodes ({selectedUpstream.algorithm})
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono block truncate">
                            {selectedUpstream.servers.map((s) => s.address).join(', ')}
                          </span>
                        </div>

                        <div className="p-2.5 bg-background/60 rounded border border-border space-y-1">
                          <span className="text-[11px] text-muted-foreground block">Internal SSL (NGINX ➔ Origin)</span>
                          <span className={`font-medium block ${selectedUpstream.internalSsl?.enabled ? 'text-primary' : 'text-foreground'}`}>
                            {selectedUpstream.internalSsl?.enabled ? 'HTTPS Active' : 'Plain HTTP'}
                          </span>
                          <span className="text-[10px] text-muted-foreground block">
                            {selectedUpstream.internalSsl?.mTLS ? 'mTLS Client Cert Enabled' : 'No Client Cert'}
                          </span>
                        </div>

                        <div className="p-2.5 bg-background/60 rounded border border-border space-y-1">
                          <span className="text-[11px] text-muted-foreground block">Probes & Transport</span>
                          <span className="font-medium text-foreground block">
                            {selectedUpstream.probes?.length || 0} active probe(s)
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono block">
                            {selectedUpstream.transport?.httpVersion || 'HTTP/1.1'}
                            {selectedUpstream.transport?.enableWebSocket ? ' · WS' : ''}
                            {selectedUpstream.transport?.enableGrpc ? ' · gRPC' : ''}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  <label className="block text-xs font-medium text-foreground">
                    Direct Backend Address <span className="text-destructive">*</span>
                  </label>
                  <div className="flex">
                    <select
                      value={directProtocol}
                      onChange={(e) => setDirectProtocol(e.target.value as 'http://' | 'https://')}
                      className="bg-muted border border-input border-r-0 rounded-l-lg px-2.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
                    >
                      <option value="http://">http://</option>
                      <option value="https://">https://</option>
                    </select>
                    <input
                      type="text"
                      placeholder="127.0.0.1:8080 or backend.internal"
                      value={directAddress}
                      onChange={(e) => setDirectAddress(e.target.value)}
                      className="flex-1 bg-background border border-input rounded-r-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Direct single server proxy without upstream pool capabilities. For load balancing or internal mTLS, select an Upstream Pool.
                  </p>
                </div>
              )}
            </div>

            {/* 3. Edge TLS & Certificates (Client ➔ NGINX) */}
            <div className="bg-card border border-border rounded-xl p-5 sm:p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 pb-3 border-b border-border">
                <Lock className="w-4 h-4 text-primary" />
                <div>
                  <h2 className="text-sm font-semibold text-card-foreground">3. Edge TLS & Certificates (Client ➔ NGINX)</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Configure SSL/TLS termination for incoming client connections to NGINX edge.
                  </p>
                </div>
              </div>

              {/* Edge TLS Mode Radio */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-xs font-medium text-foreground">
                  Edge Certificate Mode
                </label>
                <div className="flex flex-wrap items-center gap-6 pt-1">
                  {(["Let's Encrypt (Auto)", 'Custom Certificate', 'Self-signed'] as const).map(
                    (mode) => {
                      const modeValue: TlsType =
                        mode === "Let's Encrypt (Auto)"
                          ? "Let's Encrypt"
                          : mode === 'Custom Certificate'
                            ? 'Custom Cert'
                            : 'Self-signed';
                      return (
                        <label
                          key={mode}
                          className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none"
                        >
                          <input
                            type="radio"
                            name="tlsMode"
                            value={modeValue}
                            checked={tlsMode === modeValue}
                            onChange={() => setTlsMode(modeValue)}
                            className="w-3.5 h-3.5 text-primary bg-background border-input focus:ring-ring"
                          />
                          <span className={tlsMode === modeValue ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                            {mode}
                          </span>
                        </label>
                      );
                    }
                  )}
                </div>
              </div>

              {/* Dynamic TLS Inputs */}
              {tlsMode === "Let's Encrypt" && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      Contact Email for ACME Expiry Notices
                    </label>
                    <input
                      type="email"
                      placeholder="admin@example.com"
                      value={certificateEmail}
                      onChange={(e) => setCertificateEmail(e.target.value)}
                      className="w-full bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Let's Encrypt issues free 90-day certificates with automated auto-renewal at 30 days.
                    </p>
                  </div>
                </div>
              )}

              {tlsMode === 'Custom Cert' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      Upload Certificate Bundle (PEM)
                    </label>
                    <div className="border-2 border-dashed border-border hover:border-input rounded-lg p-4 text-center cursor-pointer bg-muted/20">
                      <p className="text-xs text-muted-foreground">
                        Drag and drop certificate files here, or <span className="text-primary font-medium">browse</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">Supports fullchain.pem + privkey.pem</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Min TLS & HSTS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Minimum TLS Protocol
                  </label>
                  <select
                    value={tlsVersion}
                    onChange={(e) => setTlsVersion(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-medium"
                  >
                    <option value="TLS 1.2">TLSv1.2 (Standard compatibility)</option>
                    <option value="TLS 1.3">TLSv1.3 (Highest modern security)</option>
                  </select>
                </div>

                <div className="flex flex-col justify-center pt-2">
                  <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hstsEnabled}
                      onChange={(e) => setHstsEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background"
                    />
                    <span className="font-medium">Enable HSTS (Strict-Transport-Security)</span>
                  </label>
                  <p className="text-[11px] text-muted-foreground pl-6 mt-0.5">
                    Forces browsers to always connect via HTTPS with max-age=31536000.
                  </p>
                </div>
              </div>
            </div>

            {/* 4. Edge WAF & Security Policies (Client Ingress) */}
            <div className="bg-card border border-border rounded-xl p-5 sm:p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 pb-3 border-b border-border">
                <Shield className="w-4 h-4 text-primary" />
                <div>
                  <h2 className="text-sm font-semibold text-card-foreground">4. Edge WAF & Security Policy Binding (Client Ingress)</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Inspect incoming client HTTP/HTTPS requests and enforce security guardrails at the edge.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-start gap-3 p-3.5 rounded-lg border border-border hover:border-input bg-card cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableWaf}
                    onChange={(e) => setEnableWaf(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background"
                  />
                  <div>
                    <span className="text-xs font-semibold text-foreground block">WAF Inspection Engine</span>
                    <span className="text-[11px] text-muted-foreground mt-0.5 block">
                      Inspect inbound client URI, headers, body against OWASP Top 10 exploits (SQLi, XSS, RCE).
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-lg border border-border hover:border-input bg-card cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableRateLimiting}
                    onChange={(e) => setEnableRateLimiting(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background"
                  />
                  <div>
                    <span className="text-xs font-semibold text-foreground block">Client Rate Limiting</span>
                    <span className="text-[11px] text-muted-foreground mt-0.5 block">
                      Throttle aggressive client IPs, brute-force login attempts, and DDoS bursts.
                    </span>
                  </div>
                </label>
              </div>

              {/* Policy Multi-Select Binding */}
              <div className="space-y-1.5 pt-2 border-t border-border">
                <label className="block text-xs font-medium text-foreground">
                  Bind WAF Rule Policies <span className="text-muted-foreground font-normal">({selectedPolicies.length} selected)</span>
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setPolicyDropdownOpen(!policyDropdownOpen)}
                    className="w-full flex items-center justify-between bg-background border border-input rounded-lg px-3 py-2 text-xs text-foreground hover:border-input transition-colors cursor-pointer"
                  >
                    <span className="truncate">
                      {selectedPolicies.length === 0
                        ? 'Select security policies to bind...'
                        : `${selectedPolicies.length} policy(ies) selected`}
                    </span>
                    <ChevronDown className="w-4 h-4 text-muted-foreground ml-2 shrink-0" />
                  </button>

                  {policyDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto p-2 space-y-1">
                      <div className="relative mb-2">
                        <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-2.5" />
                        <input
                          type="text"
                          placeholder="Search available policies..."
                          value={policySearch}
                          onChange={(e) => setPolicySearch(e.target.value)}
                          className="w-full bg-background border border-input rounded px-2.5 py-1.5 pl-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>

                      {availablePolicies
                        .filter((p) => (p.document?.name || `Policy #${p.id}`).toLowerCase().includes(policySearch.toLowerCase()))
                        .map((policy) => {
                          const isSelected = selectedPolicies.includes(policy.id);
                          return (
                            <div
                              key={policy.id}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedPolicies(selectedPolicies.filter((id) => id !== policy.id));
                                } else {
                                  setSelectedPolicies([...selectedPolicies, policy.id]);
                                }
                              }}
                              className={`flex items-center justify-between px-2.5 py-2 rounded text-xs cursor-pointer transition-colors ${isSelected ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-foreground'
                                }`}
                            >
                              <div className="flex items-center gap-2">
                                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${isSelected ? 'bg-primary border-primary' : 'border-input'}`}>
                                  {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                                </div>
                                <span>{policy.document?.name || `Policy #${policy.id}`}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground font-mono">{policy.document?.mode || policy.status}</span>
                            </div>
                          );
                        })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <Link
                to="/domains"
                className="px-4 py-2 text-xs font-medium border border-border bg-background hover:bg-muted text-foreground rounded-lg transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={!domainName.trim()}
                className="px-5 py-2 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors"
              >
                Create Domain Entry
              </button>
            </div>
          </div>

          {/* Right Sidebar: Sticky Domain Preview */}
          <div className="col-span-12 lg:col-span-4 sticky top-6 space-y-4">
            <div className="bg-card border border-border rounded-xl p-4 space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Domain Live Preview</h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  Ready to Bind
                </span>
              </div>

              <div className="space-y-3 text-xs">
                {/* Edge Ingress */}
                <div>
                  <span className="text-muted-foreground block text-[11px]">Edge Ingress (Client ➔ NGINX)</span>
                  <div className="font-mono font-bold text-foreground mt-0.5">
                    {domainName.trim() || 'example.com'}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Apex: <span className="font-mono text-foreground">{rootDomain.trim() || 'example.com'}</span>
                  </div>
                </div>

                {/* Edge TLS */}
                <div className="pt-2 border-t border-border space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Edge TLS</span>
                    <span className="font-medium text-foreground">{tlsMode}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Min Version:</span>
                    <span className="font-mono text-foreground">{tlsVersion}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>HSTS:</span>
                    <span className={hstsEnabled ? 'text-primary font-medium' : 'text-muted-foreground'}>
                      {hstsEnabled ? 'Enforced' : 'Disabled'}
                    </span>
                  </div>
                </div>

                {/* Target Upstream */}
                <div className="pt-2 border-t border-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Target Upstream (Egress)</span>
                    <span className="font-mono font-medium text-foreground">
                      {upstreamMode === 'pool' && selectedUpstream ? selectedUpstream.name : directAddress}
                    </span>
                  </div>
                  {upstreamMode === 'pool' && selectedUpstream && (
                    <div className="p-2 bg-muted/40 rounded border border-border text-[11px] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Topology:</span>
                        <span className="text-foreground font-medium">{selectedUpstream.type}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Internal SSL:</span>
                        <span className={selectedUpstream.internalSsl?.enabled ? 'text-primary font-medium' : 'text-muted-foreground'}>
                          {selectedUpstream.internalSsl?.enabled ? 'Backend HTTPS' : 'Plain HTTP'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Health Probes:</span>
                        <span className="text-foreground font-mono">{selectedUpstream.probes?.[0]?.path || '/health'}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Edge Security */}
                <div className="pt-2 border-t border-border space-y-1.5">
                  <span className="text-muted-foreground block text-[11px]">Edge WAF & Security</span>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">WAF Engine:</span>
                    <span className={enableWaf ? 'text-primary font-medium' : 'text-muted-foreground'}>
                      {enableWaf ? 'Active' : 'Bypass'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Rate Limiting:</span>
                    <span className={enableRateLimiting ? 'text-primary font-medium' : 'text-muted-foreground'}>
                      {enableRateLimiting ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Bound Policies:</span>
                    <span className="font-semibold text-foreground">{selectedPolicies.length} policy(ies)</span>
                  </div>
                </div>

                {/* Generated Server Block Preview */}
                <div className="pt-3 border-t border-border">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1.5">
                    <Code className="w-3.5 h-3.5" />
                    <span>NGINX Server Block (Edge)</span>
                  </div>
                  <pre className="p-2.5 bg-muted/60 rounded-lg text-[10px] font-mono text-muted-foreground overflow-x-auto leading-relaxed border border-border">
                    {`server {
  listen 443 ssl http2;
  server_name ${domainName.trim() || 'example.com'};

  # Edge TLS (Client ➔ NGINX)
  ssl_certificate /etc/letsencrypt/live/${domainName.trim() || 'example.com'}/fullchain.pem;
  ssl_protocols ${tlsVersion === 'TLS 1.3' ? 'TLSv1.3' : 'TLSv1.2 TLSv1.3'};
  ${hstsEnabled ? 'add_header Strict-Transport-Security "max-age=31536000" always;\n' : ''}
  location / {
    proxy_pass ${upstreamMode === 'pool' && selectedUpstream ? `http://${selectedUpstream.name}` : `${directProtocol}${directAddress}`};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
