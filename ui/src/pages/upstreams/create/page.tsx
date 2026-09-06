import React, { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Server,
  ShieldCheck,
  Activity,
  Zap,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Code,
  Globe,
  Lock,
  UploadCloud,
  FileText,
  Key,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type {
  UpstreamItem,
  UpstreamType,
  BalancingAlgorithm,
  UpstreamNode,
  ProbeCheckItem,
  InternalSslConfig,
  UpstreamTransportConfig,
} from '../types';
import { INITIAL_UPSTREAMS } from '../mockData';

interface CertUploadInputProps {
  id: string;
  label: string;
  sublabel?: string;
  placeholder?: string;
  value: string;
  onChange: (val: string) => void;
  fileName?: string;
  onFileNameChange?: (name: string) => void;
  fileAccept?: string;
  isPrivateKey?: boolean;
}

function CertUploadInput({
  id,
  label,
  sublabel,
  placeholder,
  value,
  onChange,
  fileName,
  onFileNameChange,
  fileAccept = '.crt,.pem,.cer,.key,.txt',
  isPrivateKey = false,
}: CertUploadInputProps) {
  const [tab, setTab] = useState<'upload' | 'paste'>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileProcess = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = (e.target?.result as string) || '';
      onChange(content);
      onFileNameChange?.(file.name);
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileProcess(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileProcess(file);
    }
  };

  const handleClear = () => {
    onChange('');
    onFileNameChange?.('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isPemValid = value.includes('-----BEGIN');
  const linesCount = value ? value.trim().split('\n').length : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
            {isPrivateKey ? <Key className="w-3.5 h-3.5 text-primary" /> : <Lock className="w-3.5 h-3.5 text-primary" />}
            <span>{label}</span>
          </label>
          {sublabel && <p className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</p>}
        </div>

        {/* Tab switcher */}
        <div className="inline-flex p-0.5 rounded-lg bg-muted border border-border text-[11px]">
          <button
            type="button"
            onClick={() => setTab('upload')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              tab === 'upload' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Upload File
          </button>
          <button
            type="button"
            onClick={() => setTab('paste')}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
              tab === 'paste' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Paste PEM
          </button>
        </div>
      </div>

      {/* Content Loaded Badge if present */}
      {value && (
        <div className="p-3 bg-muted/40 border border-border rounded-lg flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              {isPrivateKey ? <Key className="w-4 h-4 text-primary" /> : <FileText className="w-4 h-4 text-primary" />}
            </div>
            <div className="min-w-0">
              <div className="font-mono font-medium text-foreground truncate text-xs">
                {fileName || (isPrivateKey ? 'private-key.pem' : 'certificate.pem')}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                <span>{linesCount} lines</span>
                <span>•</span>
                <span className={isPemValid ? 'text-emerald-500 font-medium' : 'text-amber-500'}>
                  {isPemValid ? 'Valid PEM Header' : 'Raw Text / Custom Format'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setTab('paste')}
              className="px-2 py-1 text-[11px] font-medium border border-border rounded hover:bg-background text-foreground transition-colors cursor-pointer"
            >
              View / Edit
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors cursor-pointer"
              title="Remove certificate"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Tab Panels */}
      {tab === 'upload' && !value && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-primary bg-primary/5 scale-[0.99]'
              : 'border-border hover:border-input bg-card hover:bg-muted/10'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={fileAccept}
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-9 h-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <UploadCloud className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-foreground">
                Drag & drop certificate file, or <span className="text-primary font-semibold underline underline-offset-2">browse</span>
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                Supports {fileAccept.split(',').join(', ')}
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === 'paste' && (
        <div>
          <textarea
            rows={5}
            placeholder={
              placeholder ||
              (isPrivateKey
                ? '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'
                : '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----')
            }
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              if (!fileName) onFileNameChange?.('pasted-key.pem');
            }}
            className="w-full px-3 py-2 text-xs font-mono bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring placeholder:text-muted-foreground/60 leading-relaxed"
          />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 px-1">
            <span>{linesCount} lines · {value.length} characters</span>
            {isPemValid && <span className="text-emerald-500 font-medium">✓ Valid PEM envelope detected</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CreateUpstreamPage() {
  const navigate = useNavigate();

  // 1. Basic Information
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<UpstreamType>('Load Balancer');

  // 2. Server Pool / Target
  const [singleAddress, setSingleAddress] = useState('10.0.1.10:8080');
  const [algorithm, setAlgorithm] = useState<BalancingAlgorithm>('round_robin');
  const [lbServers, setLbServers] = useState<UpstreamNode[]>([
    { id: 'node-1', address: '10.0.1.10:8080', weight: 1, maxFails: 3, failTimeout: '10s', backup: false, healthy: true },
    { id: 'node-2', address: '10.0.1.11:8080', weight: 1, maxFails: 3, failTimeout: '10s', backup: false, healthy: true },
  ]);
  const [externalFqdn, setExternalFqdn] = useState('');
  const [sniOverride, setSniOverride] = useState(true);
  const [dynamicDns, setDynamicDns] = useState(true);

  // 3. Internal SSL (NGINX ➔ Backend)
  const [internalSslEnabled, setInternalSslEnabled] = useState(false);
  const [verifyCert, setVerifyCert] = useState(true);
  const [sniHost, setSniHost] = useState('');
  const [customCaEnabled, setCustomCaEnabled] = useState(false);
  const [caCert, setCaCert] = useState('');
  const [caCertFileName, setCaCertFileName] = useState('');
  const [mTLS, setMTLS] = useState(false);
  const [clientCert, setClientCert] = useState('');
  const [clientCertFileName, setClientCertFileName] = useState('');
  const [clientKey, setClientKey] = useState('');
  const [clientKeyFileName, setClientKeyFileName] = useState('');

  // 4. Probes
  const [probes, setProbes] = useState<ProbeCheckItem[]>([
    { id: 'p-1', type: 'Readiness', path: '/health', expectedStatus: 200, intervalSec: 10, timeoutSec: 3 },
  ]);
  const [newProbeType, setNewProbeType] = useState<'Readiness' | 'Liveness' | 'Health'>('Readiness');
  const [newProbePath, setNewProbePath] = useState('');
  const [newProbeStatus, setNewProbeStatus] = useState(200);

  // 5. Transport & Protocols
  const [httpVersion, setHttpVersion] = useState<'HTTP/1.1' | 'HTTP/2' | 'HTTP/3' | 'HTTP/1.0'>('HTTP/1.1');
  const [enableWebSocket, setEnableWebSocket] = useState(false);
  const [enableSse, setEnableSse] = useState(false);
  const [enableGrpc, setEnableGrpc] = useState(false);
  const [keepAliveConnections, setKeepAliveConnections] = useState(32);

  // Node pool management
  const handleAddNode = () => {
    setLbServers([
      ...lbServers,
      {
        id: `node-${Date.now()}`,
        address: '',
        weight: 1,
        maxFails: 3,
        failTimeout: '10s',
        backup: false,
        healthy: true,
      },
    ]);
  };

  const handleUpdateNode = (id: string, updates: Partial<UpstreamNode>) => {
    setLbServers(lbServers.map((node) => (node.id === id ? { ...node, ...updates } : node)));
  };

  const handleRemoveNode = (id: string) => {
    if (lbServers.length <= 1) return;
    setLbServers(lbServers.filter((node) => node.id !== id));
  };

  // Probe management
  const handleAddProbe = () => {
    const trimmed = newProbePath.trim();
    if (!trimmed) return;
    const formatted = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (probes.some((p) => p.path === formatted && p.type === newProbeType)) return;
    setProbes([
      ...probes,
      {
        id: `probe-${Date.now()}`,
        type: newProbeType,
        path: formatted,
        expectedStatus: newProbeStatus || 200,
        intervalSec: 10,
        timeoutSec: 3,
      },
    ]);
    setNewProbePath('');
  };

  const handleRemoveProbe = (id: string) => {
    setProbes(probes.filter((p) => p.id !== id));
  };

  // Submit
  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let finalServers: UpstreamNode[] = [];
    if (type === 'Single Server') {
      finalServers = [
        { id: 'node-single', address: singleAddress.trim() || '127.0.0.1:8080', weight: 1, healthy: true },
      ];
    } else if (type === 'Load Balancer') {
      finalServers = lbServers.map((s) => ({
        ...s,
        address: s.address.trim() || '127.0.0.1:8080',
      }));
    } else {
      finalServers = [
        { id: 'node-ext', address: externalFqdn.trim() || 'origin.internal', weight: 1, healthy: true },
      ];
    }

    const newUpstream: UpstreamItem = {
      id: `ups-${Date.now()}`,
      name: name.trim().toLowerCase().replace(/\s+/g, '-'),
      description: description.trim(),
      type,
      algorithm,
      servers: finalServers,
      externalFqdn: type === 'External (FQDN)' ? externalFqdn.trim() : undefined,
      sniOverride: type === 'External (FQDN)' ? sniOverride : undefined,
      dynamicDns: type === 'External (FQDN)' ? dynamicDns : undefined,
      internalSsl: {
        enabled: internalSslEnabled,
        verifyCert,
        sniHost: sniHost.trim() || undefined,
        caCert: verifyCert && customCaEnabled && caCert.trim() ? caCert.trim() : undefined,
        mTLS,
        clientCertName: mTLS ? (clientCertFileName || 'aurora-internal-client.crt') : undefined,
        clientCert: mTLS && clientCert.trim() ? clientCert.trim() : undefined,
        clientKey: mTLS && clientKey.trim() ? clientKey.trim() : undefined,
      },
      probes,
      transport: {
        httpVersion,
        enableWebSocket,
        enableSse,
        enableGrpc,
        keepAliveConnections,
      },
      boundDomainsCount: 0,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    };

    let currentList: UpstreamItem[] = [];
    try {
      const saved = localStorage.getItem('aurora_waf_upstreams');
      if (saved) {
        currentList = JSON.parse(saved);
      } else {
        currentList = INITIAL_UPSTREAMS;
      }
    } catch {
      currentList = INITIAL_UPSTREAMS;
    }

    const updated = [newUpstream, ...currentList];
    try {
      localStorage.setItem('aurora_waf_upstreams', JSON.stringify(updated));
    } catch (err) {
      console.error('Failed to save upstream:', err);
    }

    navigate('/upstreams');
  };

  return (
    <div className="p-4 sm:p-6 w-full space-y-6 pb-16 font-sans min-w-0">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <Link
          to="/upstreams"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Upstreams
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Create Upstream Pool</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Define backend server targets, load balancing, internal SSL (NGINX ➔ Backend), and probe health checks.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleCreate}>
        <div className="grid grid-cols-12 gap-6 items-start">
          {/* Main Form Fields */}
          <div className="col-span-12 lg:col-span-8 space-y-6">
            {/* Section 1: Basic Information */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-sm">
              <div className="flex items-center gap-2 pb-3 border-b border-border">
                <Server className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-card-foreground">1. Upstream Identification</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Upstream Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. prod-api-cluster"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring placeholder:text-muted-foreground"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Unique identifier referenced by edge domain bindings.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Architecture Type
                  </label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as UpstreamType)}
                    className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
                  >
                    <option value="Load Balancer">Load Balancer (Multi-node Pool)</option>
                    <option value="Single Server">Single Backend Server</option>
                    <option value="External (FQDN)">External Origin (FQDN / Cloud ALB)</option>
                  </select>
                </div>

                <div className="col-span-full">
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Description <span className="text-muted-foreground font-normal">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Primary microservices gateway for customer auth & transactions"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Backend Target / Server Pool */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Server className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold text-card-foreground">2. Backend Target & Load Balancing</h2>
                </div>
                {type === 'Load Balancer' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Algorithm:</span>
                    <select
                      value={algorithm}
                      onChange={(e) => setAlgorithm(e.target.value as BalancingAlgorithm)}
                      className="px-2.5 py-1 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="round_robin">Round Robin</option>
                      <option value="least_conn">Least Connections</option>
                      <option value="ip_hash">IP Hash (Client Sticky)</option>
                    </select>
                  </div>
                )}
              </div>

              {type === 'Single Server' && (
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Backend Server Address <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="10.0.1.10:8080 or unix:/run/app.sock"
                    value={singleAddress}
                    onChange={(e) => setSingleAddress(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring font-mono placeholder:text-muted-foreground"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Enter the internal host:port or Unix domain socket of the backend instance.
                  </p>
                </div>
              )}

              {type === 'Load Balancer' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Nodes in pool ({lbServers.length}). Traffic will be balanced using{' '}
                      <span className="font-semibold text-foreground font-mono">{algorithm}</span>.
                    </p>
                    <button
                      type="button"
                      onClick={handleAddNode}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 rounded-lg transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Node
                    </button>
                  </div>

                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/40 border-b border-border text-muted-foreground font-medium">
                        <tr>
                          <th className="px-3 py-2">Node Address (Host:Port)</th>
                          <th className="px-3 py-2 w-24">Weight</th>
                          <th className="px-3 py-2 w-28">Max Fails</th>
                          <th className="px-3 py-2 w-28">Fail Timeout</th>
                          <th className="px-3 py-2 w-24 text-center">Backup</th>
                          <th className="px-3 py-2 w-12 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {lbServers.map((node) => (
                          <tr key={node.id} className="hover:bg-muted/20">
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                placeholder="10.0.1.10:8080"
                                value={node.address}
                                onChange={(e) => handleUpdateNode(node.id, { address: e.target.value })}
                                className="w-full px-2.5 py-1 text-xs bg-background border border-input rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={1}
                                max={100}
                                value={node.weight}
                                onChange={(e) => handleUpdateNode(node.id, { weight: parseInt(e.target.value) || 1 })}
                                className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring text-center font-mono"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                min={1}
                                max={10}
                                value={node.maxFails ?? 3}
                                onChange={(e) => handleUpdateNode(node.id, { maxFails: parseInt(e.target.value) || 3 })}
                                className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring text-center font-mono"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={node.failTimeout ?? '10s'}
                                onChange={(e) => handleUpdateNode(node.id, { failTimeout: e.target.value })}
                                className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground focus:outline-none focus:ring-1 focus:ring-ring text-center font-mono"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={node.backup || false}
                                onChange={(e) => handleUpdateNode(node.id, { backup: e.target.checked })}
                                className="h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                type="button"
                                disabled={lbServers.length <= 1}
                                onClick={() => handleRemoveNode(node.id)}
                                className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {type === 'External (FQDN)' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      External Origin FQDN <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="origin-alb.us-east-1.elb.amazonaws.com"
                      value={externalFqdn}
                      onChange={(e) => setExternalFqdn(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring font-mono placeholder:text-muted-foreground"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <label className="flex items-start gap-2.5 p-3 rounded-lg border border-border hover:border-input bg-card cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sniOverride}
                        onChange={(e) => setSniOverride(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background"
                      />
                      <div>
                        <span className="text-xs font-medium text-foreground block">SNI Hostname Forwarding</span>
                        <span className="text-[11px] text-muted-foreground">Forward origin FQDN in TLS SNI extension</span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 p-3 rounded-lg border border-border hover:border-input bg-card cursor-pointer">
                      <input
                        type="checkbox"
                        checked={dynamicDns}
                        onChange={(e) => setDynamicDns(e.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background"
                      />
                      <div>
                        <span className="text-xs font-medium text-foreground block">Dynamic DNS Re-resolution</span>
                        <span className="text-[11px] text-muted-foreground">Periodically resolve AWS/GCP dynamic IP changes</span>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Section 3: Internal SSL / Backend TLS */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" />
                  <div>
                    <h2 className="text-sm font-semibold text-card-foreground">3. Internal SSL & Backend TLS (NGINX ➔ Backend)</h2>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={internalSslEnabled}
                    onChange={(e) => setInternalSslEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-background after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              <div className="p-3 bg-muted/40 rounded-lg border border-border text-[11px] text-muted-foreground flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span>
                  Internal SSL governs TLS encryption between <strong>NGINX and your backend origin</strong>. Edge TLS (Client ➔ NGINX) is configured under individual Domain settings.
                </span>
              </div>

              {internalSslEnabled ? (
                <div className="space-y-5 pt-1">
                  {/* Origin SNI Host & Verify Cert */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        Origin SNI Hostname <span className="text-muted-foreground font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        placeholder="backend.internal.net"
                        value={sniHost}
                        onChange={(e) => setSniHost(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring placeholder:text-muted-foreground font-mono"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">Sets proxy_ssl_name to match backend certificate SAN.</p>
                    </div>

                    <div className="flex flex-col justify-center pt-2">
                      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={verifyCert}
                          onChange={(e) => setVerifyCert(e.target.checked)}
                          className="h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background cursor-pointer"
                        />
                        <span className="font-medium">Verify Origin Certificate (Recommended)</span>
                      </label>
                      <p className="text-[11px] text-muted-foreground pl-6 mt-0.5">Enforces proxy_ssl_verify on. Validates origin TLS against CA.</p>
                    </div>
                  </div>

                  {/* Custom CA Certificate (When verifying origin) */}
                  {verifyCert && (
                    <div className="p-4 bg-muted/20 border border-border rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer">
                          <input
                            type="checkbox"
                            checked={customCaEnabled}
                            onChange={(e) => setCustomCaEnabled(e.target.checked)}
                            className="h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background cursor-pointer"
                          />
                          <span>Use Custom / Internal CA Certificate Bundle</span>
                        </label>
                        <span className="text-[10px] text-muted-foreground font-mono">proxy_ssl_trusted_certificate</span>
                      </div>

                      {customCaEnabled && (
                        <div className="pt-2">
                          <CertUploadInput
                            id="ca-cert"
                            label="Custom Root/Intermediate CA Certificate (PEM)"
                            sublabel="Upload or paste internal private PKI root/intermediate CA certificate to verify backend origin."
                            placeholder="-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJAL...\n-----END CERTIFICATE-----"
                            value={caCert}
                            onChange={setCaCert}
                            fileName={caCertFileName}
                            onFileNameChange={setCaCertFileName}
                            fileAccept=".crt,.pem,.ca-bundle,.cer"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Internal mTLS to Backend */}
                  <div className="pt-2 border-t border-border space-y-4">
                    <label className="flex items-center justify-between p-3.5 rounded-lg border border-border hover:border-input bg-background/50 cursor-pointer">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <Key className="w-3.5 h-3.5 text-primary" />
                          <span className="text-xs font-semibold text-foreground">Internal mTLS to Backend</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          Present a client certificate from NGINX to origin for zero-trust mutual authentication
                        </span>
                      </div>
                      <input
                        type="checkbox"
                        checked={mTLS}
                        onChange={(e) => setMTLS(e.target.checked)}
                        className="h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background cursor-pointer"
                      />
                    </label>

                    {mTLS && (
                      <div className="p-4 bg-muted/20 border border-border rounded-xl space-y-5">
                        <div className="flex items-center gap-2 pb-2 border-b border-border">
                          <ShieldCheck className="w-4 h-4 text-primary" />
                          <span className="text-xs font-semibold text-foreground">
                            mTLS Client Credentials (NGINX Client Identity)
                          </span>
                        </div>

                        {/* Client Certificate */}
                        <CertUploadInput
                          id="mtls-client-cert"
                          label="Client Certificate (PEM / CRT)"
                          sublabel="Public client certificate sent to backend during TLS handshake."
                          placeholder="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
                          value={clientCert}
                          onChange={setClientCert}
                          fileName={clientCertFileName}
                          onFileNameChange={setClientCertFileName}
                          fileAccept=".crt,.pem,.cer"
                        />

                        {/* Client Private Key */}
                        <CertUploadInput
                          id="mtls-client-key"
                          label="Client Private Key (PEM / KEY)"
                          sublabel="Private cryptographic key matching the client certificate (kept securely in memory)."
                          placeholder="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
                          value={clientKey}
                          onChange={setClientKey}
                          fileName={clientKeyFileName}
                          onFileNameChange={setClientKeyFileName}
                          fileAccept=".key,.pem"
                          isPrivateKey={true}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="py-2 text-xs text-muted-foreground">
                  Internal SSL is disabled. NGINX will connect to backend via plain HTTP (<span className="font-mono text-foreground">http://</span>).
                </div>
              )}
            </div>

            {/* Section 4: Probes & Health Checks */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-sm">
              <div className="flex items-center gap-2 pb-3 border-b border-border">
                <Activity className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-card-foreground">4. Active Probes & Health Checks</h2>
              </div>

              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Configure health, readiness, or liveness probes to monitor backend availability and route around failures.
                </p>

                {/* Add probe inputs */}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={newProbeType}
                    onChange={(e) => setNewProbeType(e.target.value as 'Readiness' | 'Liveness' | 'Health')}
                    className="px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="Readiness">Readiness</option>
                    <option value="Liveness">Liveness</option>
                    <option value="Health">Health</option>
                  </select>

                  <div className="flex-1 min-w-[200px]">
                    <input
                      type="text"
                      placeholder="Probe path e.g. /healthz or /ready"
                      value={newProbePath}
                      onChange={(e) => setNewProbePath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddProbe();
                        }
                      }}
                      className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground font-mono"
                    />
                  </div>

                  <div className="w-24">
                    <input
                      type="number"
                      placeholder="200"
                      value={newProbeStatus}
                      onChange={(e) => setNewProbeStatus(parseInt(e.target.value) || 200)}
                      className="w-full px-2.5 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring text-center font-mono"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleAddProbe}
                    className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Probe
                  </button>
                </div>

                {/* Probes list */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {probes.map((probe) => (
                    <div
                      key={probe.id}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-background text-xs"
                    >
                      <span className="font-semibold text-primary">{probe.type}</span>
                      <span className="font-mono text-foreground">{probe.path}</span>
                      <span className="text-[11px] text-muted-foreground font-mono">({probe.expectedStatus || 200})</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveProbe(probe.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors ml-1 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Section 5: Transport & Protocols */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-sm">
              <div className="flex items-center gap-2 pb-3 border-b border-border">
                <Zap className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-card-foreground">5. Transport & Protocols (Upstream)</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    HTTP Protocol Version to Backend
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {(['HTTP/1.1', 'HTTP/2', 'HTTP/3', 'HTTP/1.0'] as const).map((ver) => (
                      <button
                        key={ver}
                        type="button"
                        onClick={() => setHttpVersion(ver)}
                        className={`px-3 py-2 rounded-lg border text-xs font-medium transition-all text-center cursor-pointer ${
                          httpVersion === ver
                            ? 'bg-primary/10 border-primary text-primary shadow-xs'
                            : 'bg-background border-border text-foreground hover:border-input'
                        }`}
                      >
                        {ver}
                        <span className="block text-[10px] text-muted-foreground font-normal mt-0.5">
                          {ver === 'HTTP/1.1'
                            ? 'Default / Standard'
                            : ver === 'HTTP/2'
                            ? 'gRPC & Multiplexing'
                            : ver === 'HTTP/3'
                            ? 'QUIC / UDP 0-RTT'
                            : 'Legacy'}
                        </span>
                      </button>
                    ))}
                  </div>
                  {httpVersion === 'HTTP/3' && (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
                      <span className="font-semibold text-primary">QUIC / HTTP/3:</span>
                      <span>Requires UDP port pass-through and upstream QUIC/TLS 1.3 support on backend hosts.</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-border hover:border-input bg-background/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableWebSocket}
                      onChange={(e) => setEnableWebSocket(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background"
                    />
                    <div>
                      <span className="text-xs font-medium text-foreground block">WebSocket Support</span>
                      <span className="text-[10px] text-muted-foreground">Upgrade & Connection headers</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-border hover:border-input bg-background/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableSse}
                      onChange={(e) => setEnableSse(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background"
                    />
                    <div>
                      <span className="text-xs font-medium text-foreground block">Server-Sent Events</span>
                      <span className="text-[10px] text-muted-foreground">proxy_buffering off</span>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-3 rounded-lg border border-border hover:border-input bg-background/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableGrpc}
                      onChange={(e) => {
                        setEnableGrpc(e.target.checked);
                        if (e.target.checked && httpVersion === 'HTTP/1.1') {
                          setHttpVersion('HTTP/2');
                        }
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring bg-background"
                    />
                    <div>
                      <span className="text-xs font-medium text-foreground block">gRPC Mode</span>
                      <span className="text-[10px] text-muted-foreground">grpc_pass with HTTP/2</span>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      Keep-Alive Connections Pool
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={512}
                      value={keepAliveConnections}
                      onChange={(e) => setKeepAliveConnections(parseInt(e.target.value) || 32)}
                      className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                    />
                    <p className="text-[11px] text-muted-foreground mt-1">Number of idle keepalive connections cached per worker.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <Link
                to="/upstreams"
                className="px-4 py-2 text-xs font-medium border border-border bg-background hover:bg-muted text-foreground rounded-lg transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={!name.trim()}
                className="px-5 py-2 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                Create Upstream Pool
              </button>
            </div>
          </div>

          {/* Right Sidebar: Sticky Live Preview */}
          <div className="col-span-12 lg:col-span-4 sticky top-6 space-y-4">
            <div className="p-4 bg-card border border-border rounded-xl space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Upstream Preview</h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                  {type}
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-muted-foreground block text-[11px]">Upstream Pool Name</span>
                  <span className="font-mono font-medium text-foreground">
                    {name.trim() ? name.trim().toLowerCase().replace(/\s+/g, '-') : 'unnamed-upstream'}
                  </span>
                </div>

                <div className="pt-2 border-t border-border">
                  <span className="text-muted-foreground block text-[11px]">Target Topology</span>
                  {type === 'Single Server' && (
                    <span className="font-mono text-foreground block">{singleAddress || '10.0.1.10:8080'}</span>
                  )}
                  {type === 'Load Balancer' && (
                    <div className="space-y-1 mt-0.5">
                      <div className="flex items-center justify-between">
                        <span className="text-foreground font-medium">{lbServers.length} nodes</span>
                        <span className="font-mono text-muted-foreground text-[10px]">{algorithm}</span>
                      </div>
                      <div className="max-h-24 overflow-y-auto space-y-1">
                        {lbServers.map((s, idx) => (
                          <div key={idx} className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                            <span>{s.address || '10.0.1.x'}</span>
                            <span>wt: {s.weight}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {type === 'External (FQDN)' && (
                    <span className="font-mono text-foreground block">{externalFqdn || 'origin.internal'}</span>
                  )}
                </div>

                <div className="pt-2 border-t border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Internal SSL</span>
                    <span className={`font-medium ${internalSslEnabled ? 'text-primary' : 'text-muted-foreground'}`}>
                      {internalSslEnabled ? 'Enabled (HTTPS)' : 'Plain HTTP'}
                    </span>
                  </div>
                  {internalSslEnabled && (
                    <div className="text-[11px] text-muted-foreground space-y-1 pl-2 border-l border-border">
                      <div className="flex justify-between">
                        <span>Verify Cert:</span>
                        <span className="text-foreground font-medium">{verifyCert ? 'Enforced' : 'Off'}</span>
                      </div>
                      {verifyCert && caCert && (
                        <div className="flex justify-between text-emerald-500 font-medium">
                          <span>CA Bundle:</span>
                          <span className="truncate max-w-[120px]">{caCertFileName || 'Custom CA'}</span>
                        </div>
                      )}
                      {mTLS && (
                        <div className="flex justify-between text-primary font-medium">
                          <span>mTLS Client:</span>
                          <span className="truncate max-w-[120px]">{clientCertFileName || 'Configured'}</span>
                        </div>
                      )}
                      {sniHost && (
                        <div className="flex justify-between">
                          <span>SNI Host:</span>
                          <span className="font-mono text-foreground">{sniHost}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-border space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Active Probes</span>
                    <span className="font-medium text-foreground">{probes.length} configured</span>
                  </div>
                  <div className="space-y-1">
                    {probes.map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                        <span>{p.type}: {p.path}</span>
                        <span>HTTP {p.expectedStatus || 200}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-border">
                  <span className="text-muted-foreground block text-[11px] mb-1">Transport Features</span>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono text-foreground">
                      {httpVersion}
                    </span>
                    {enableWebSocket && (
                      <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">WebSocket</span>
                    )}
                    {enableSse && (
                      <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">SSE</span>
                    )}
                    {enableGrpc && (
                      <span className="px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">gRPC</span>
                    )}
                  </div>
                </div>
              </div>

              {/* NGINX Config snippet preview */}
              <div className="pt-3 border-t border-border">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-1.5">
                  <Code className="w-3.5 h-3.5" />
                  <span>NGINX Upstream & Egress Directive</span>
                </div>
                <pre className="p-2.5 bg-muted/60 rounded-lg text-[10px] font-mono text-muted-foreground overflow-x-auto leading-relaxed border border-border">
{`upstream ${name.trim() ? name.trim().toLowerCase().replace(/\s+/g, '-') : 'backend_pool'} {
  ${type === 'Load Balancer' && algorithm !== 'round_robin' ? `${algorithm};\n  ` : ''}${type === 'Load Balancer' 
    ? lbServers.map((s) => `server ${s.address || '127.0.0.1:8080'} weight=${s.weight}${s.backup ? ' backup' : ''};`).join('\n  ') 
    : type === 'External (FQDN)' 
      ? `server ${externalFqdn || 'origin.internal'};` 
      : `server ${singleAddress || '127.0.0.1:8080'};`}
  keepalive ${keepAliveConnections};
}

# Proxy Egress Directives:
${internalSslEnabled ? `proxy_ssl_server_name on;
${sniHost ? `proxy_ssl_name ${sniHost};\n` : ''}${verifyCert ? `proxy_ssl_verify on;\n${caCert ? 'proxy_ssl_trusted_certificate /etc/nginx/ssl/internal_ca.crt;\n' : ''}` : 'proxy_ssl_verify off;\n'}${mTLS ? `proxy_ssl_certificate /etc/nginx/ssl/client.crt;\nproxy_ssl_certificate_key /etc/nginx/ssl/client.key;\n` : ''}` : '# plain HTTP connection'}proxy_http_version ${httpVersion === 'HTTP/3' ? '3.0' : httpVersion === 'HTTP/2' ? '2.0' : httpVersion === 'HTTP/1.0' ? '1.0' : '1.1'};${httpVersion === 'HTTP/3' ? '\n# HTTP/3 over QUIC transport enabled' : ''}`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
