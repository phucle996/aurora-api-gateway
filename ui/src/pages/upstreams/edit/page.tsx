import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
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
  RefreshCw,
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
import { upstreamsApi } from '../../../lib/api/upstreams';

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

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
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
            Paste Text
          </button>
        </div>
      </div>

      {tab === 'upload' ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-4 transition-all duration-150 text-center ${
            isDragging
              ? 'border-primary bg-primary/5 scale-[0.99]'
              : value
              ? 'border-primary/40 bg-primary/5'
              : 'border-border hover:border-primary/50 bg-background/50 hover:bg-muted/30'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            id={id}
            accept={fileAccept}
            onChange={handleFileChange}
            className="hidden"
          />

          {value ? (
            <div className="flex items-center justify-between gap-3 text-left">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {fileName || (isPrivateKey ? 'private-key.key' : 'certificate.crt')}
                  </p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    {isPemValid ? (
                      <span className="text-primary inline-flex items-center gap-0.5">
                        <Check className="w-3 h-3" /> Valid PEM format
                      </span>
                    ) : (
                      <span className="text-destructive inline-flex items-center gap-0.5">
                        <AlertCircle className="w-3 h-3" /> Non-standard PEM
                      </span>
                    )}
                    <span>•</span>
                    <span>{linesCount} lines</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2 py-1 text-[11px] font-medium bg-background hover:bg-muted border border-border rounded text-foreground transition-colors cursor-pointer"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors cursor-pointer"
                  title="Remove certificate"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer py-3 space-y-1.5"
            >
              <div className="w-8 h-8 mx-auto rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                <UploadCloud className="w-4 h-4" />
              </div>
              <div className="text-xs">
                <span className="font-semibold text-primary hover:underline">Click to upload</span> or drag and drop
              </div>
              <p className="text-[11px] text-muted-foreground">
                Accepted formats: .crt, .pem, .key, .cer (Base64 ASCII)
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <textarea
            rows={4}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              if (e.target.value) {
                onFileNameChange?.('pasted-content.pem');
              }
            }}
            placeholder={placeholder || '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
            className="w-full px-3 py-2 text-[11px] font-mono bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring placeholder:text-muted-foreground leading-relaxed"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {value ? (
                isPemValid ? (
                  <span className="text-primary inline-flex items-center gap-1">
                    <Check className="w-3 h-3" /> Valid PEM format ({linesCount} lines)
                  </span>
                ) : (
                  <span className="text-amber-500 inline-flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Header missing -----BEGIN
                  </span>
                )
              ) : (
                'Paste raw base64 PEM block above'
              )}
            </span>
            {value && (
              <button
                type="button"
                onClick={handleClear}
                className="text-muted-foreground hover:text-destructive cursor-pointer text-[11px]"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function EditUpstreamPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [initialName, setInitialName] = useState('');
  const [boundDomainsCount, setBoundDomainsCount] = useState(0);

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<UpstreamType>('Load Balancer');
  const [algorithm, setAlgorithm] = useState<BalancingAlgorithm>('least_conn');

  // Single Server
  const [singleAddress, setSingleAddress] = useState('');

  // Load Balancer
  const [lbServers, setLbServers] = useState<UpstreamNode[]>([]);

  // External FQDN
  const [externalFqdn, setExternalFqdn] = useState('');
  const [sniOverride, setSniOverride] = useState(true);
  const [dynamicDns, setDynamicDns] = useState(true);

  // Internal SSL & mTLS
  const [internalSslEnabled, setInternalSslEnabled] = useState(false);
  const [verifyCert, setVerifyCert] = useState(false);
  const [sniHost, setSniHost] = useState('');
  const [customCaEnabled, setCustomCaEnabled] = useState(false);
  const [caCert, setCaCert] = useState('');
  const [caFileName, setCaFileName] = useState('');
  const [mTLS, setMTLS] = useState(false);
  const [clientCert, setClientCert] = useState('');
  const [clientCertFileName, setClientCertFileName] = useState('');
  const [clientKey, setClientKey] = useState('');
  const [clientKeyConfigured, setClientKeyConfigured] = useState(false);
  const [clientKeyFileName, setClientKeyFileName] = useState('');

  // Probe Checks
  const [probes, setProbes] = useState<ProbeCheckItem[]>([]);

  // Transport
  const [httpVersion, setHttpVersion] = useState<'HTTP/1.1' | 'HTTP/2' | 'HTTP/3' | 'HTTP/1.0'>('HTTP/1.1');
  const [enableWebSocket, setEnableWebSocket] = useState(true);
  const [enableSse, setEnableSse] = useState(true);
  const [enableGrpc, setEnableGrpc] = useState(false);
  const [requestCompression, setRequestCompression] = useState<'none' | 'gzip' | 'deflate'>('none');
  const [compressionMinBytes, setCompressionMinBytes] = useState(1024);
  const [compressionLevel, setCompressionLevel] = useState(6);
  const [keepAliveConnections, setKeepAliveConnections] = useState<number>(32);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Fetch upstream data on mount
  useEffect(() => {
    if (!id) {
      setLoadError('Missing upstream ID');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError('');

    upstreamsApi
      .getById(id)
      .then((item) => {
        setName(item.name);
        setInitialName(item.name);
        setDescription(item.description || '');
        setType(item.type);
        setAlgorithm(item.algorithm || 'least_conn');
        setBoundDomainsCount(item.boundDomainsCount || 0);

        if (item.type === 'Single Server') {
          if (item.servers.length > 0) {
            setSingleAddress(item.servers[0].address);
          }
        } else if (item.type === 'Load Balancer') {
          if (item.servers.length > 0) {
            setLbServers(item.servers);
          }
        } else if (item.type === 'External (FQDN)') {
          setExternalFqdn(item.externalFqdn || item.servers[0]?.address || '');
          setSniOverride(item.sniOverride ?? true);
          setDynamicDns(item.dynamicDns ?? true);
        }

        // Internal SSL
        if (item.internalSsl) {
          setInternalSslEnabled(Boolean(item.internalSsl.enabled));
          setVerifyCert(Boolean(item.internalSsl.verifyCert));
          setSniHost(item.internalSsl.sniHost || '');
          if (item.internalSsl.caCert) {
            setCustomCaEnabled(true);
            setCaCert(item.internalSsl.caCert);
            setCaFileName('internal-ca.crt');
          }
          setMTLS(Boolean(item.internalSsl.mTLS));
          if (item.internalSsl.clientCert) {
            setClientCert(item.internalSsl.clientCert);
            setClientCertFileName(item.internalSsl.clientCertName || 'client.crt');
          }
          setClientKey('');
          setClientKeyConfigured(Boolean(item.internalSsl.clientKeyConfigured));
        }

        // Probes
        if (item.probes && item.probes.length > 0) {
          setProbes(item.probes);
        }

        // Transport
        if (item.transport) {
          setHttpVersion(item.transport.httpVersion || 'HTTP/1.1');
          setEnableWebSocket(Boolean(item.transport.enableWebSocket));
          setEnableSse(Boolean(item.transport.enableSse));
          setEnableGrpc(Boolean(item.transport.enableGrpc));
          setRequestCompression(item.transport.requestCompression || 'none');
          setCompressionMinBytes(item.transport.compressionMinBytes ?? 1024);
          setCompressionLevel(item.transport.compressionLevel ?? 6);
          setKeepAliveConnections(item.transport.keepAliveConnections || 32);
        }
      })
      .catch((err) => {
        console.error('Failed to load upstream:', err);
        setLoadError(err?.message || 'Không tìm thấy hoặc không thể tải cấu hình Upstream');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  const addLbServer = () => {
    const nextId = String(Date.now());
    setLbServers((prev) => [
      ...prev,
      { id: nextId, address: '10.0.1.11:8080', weight: 1, healthy: false, maxFails: 3, failTimeout: '10s' },
    ]);
  };

  const removeLbServer = (serverId: string) => {
    if (lbServers.length <= 1) return;
    setLbServers((prev) => prev.filter((s) => s.id !== serverId));
  };

  const updateLbServer = (serverId: string, field: keyof UpstreamNode, val: any) => {
    setLbServers((prev) =>
      prev.map((s) => (s.id === serverId ? { ...s, [field]: val } : s))
    );
  };

  const addProbe = () => {
    const nextId = String(Date.now());
    setProbes((prev) => [
      ...prev,
      { id: nextId, type: 'Health', path: '/health', expectedStatus: 200, intervalSec: 10, timeoutSec: 3 },
    ]);
  };

  const removeProbe = (probeId: string) => {
    setProbes((prev) => prev.filter((p) => p.id !== probeId));
  };

  const updateProbe = (probeId: string, field: keyof ProbeCheckItem, val: any) => {
    setProbes((prev) =>
      prev.map((p) => (p.id === probeId ? { ...p, [field]: val } : p))
    );
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!id) return;

    let finalServers: UpstreamNode[] = [];
    if (type === 'Single Server') {
      finalServers = [
        {
          id: 'single-1',
          address: singleAddress.trim(),
          weight: 1,
          healthy: false,
        },
      ];
    } else if (type === 'Load Balancer') {
      finalServers = lbServers.map((s) => ({
        ...s,
        address: s.address.trim(),
      }));
    } else if (type === 'External (FQDN)') {
      finalServers = [
        {
          id: 'ext-1',
          address: externalFqdn.trim(),
          weight: 1,
          healthy: false,
        },
      ];
    }

    const payload = {
      name: name.trim().toLowerCase().replace(/\s+/g, '-'),
      description: description.trim(),
      architecture_type: type,
      algorithm,
      servers: finalServers,
      external_fqdn: type === 'External (FQDN)' ? externalFqdn.trim() : undefined,
      sni_override: type === 'External (FQDN)' ? sniOverride : undefined,
      dynamic_dns: dynamicDns,
      internal_ssl: {
        enabled: internalSslEnabled,
        verifyCert: internalSslEnabled && verifyCert,
        sniHost: internalSslEnabled ? sniHost.trim() || undefined : undefined,
        caCert: internalSslEnabled && verifyCert && customCaEnabled && caCert.trim() ? caCert.trim() : undefined,
        mTLS: internalSslEnabled && mTLS,
        clientCertName: internalSslEnabled && mTLS ? (clientCertFileName || 'aurora-internal-client.crt') : undefined,
        clientCert: internalSslEnabled && mTLS && clientCert.trim() ? clientCert.trim() : undefined,
        clientKey: internalSslEnabled && mTLS && clientKey.trim() ? clientKey.trim() : undefined,
      },
      probes: probes.map((p) => ({
        id: p.id,
        type: p.type,
        path: p.path,
        expectedStatus: p.expectedStatus || 200,
        intervalSec: p.intervalSec,
        timeoutSec: p.timeoutSec,
      })),
      transport: {
        httpVersion,
        enableWebSocket,
        enableSse,
        enableGrpc, requestCompression, compressionMinBytes, compressionLevel,
        keepAliveConnections,
      },
    };

    setSubmitting(true);
    setErrorMsg('');

    try {
      await upstreamsApi.update(id, payload);
      navigate('/upstreams');
    } catch (err: any) {
      console.error('Failed to update upstream via API:', err);
      const msg = err?.message || 'Không thể lưu thay đổi Upstream tới máy chủ Control-Plane';
      setErrorMsg(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 w-full flex flex-col items-center justify-center space-y-3 text-muted-foreground font-sans">
        <RefreshCw className="w-6 h-6 animate-spin text-primary" />
        <p className="text-xs">Loading upstream pool configuration...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-8 w-full max-w-lg mx-auto text-center space-y-4 font-sans">
        <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
        <h2 className="text-sm font-bold text-foreground">Upstream Pool Not Found</h2>
        <p className="text-xs text-muted-foreground">{loadError}</p>
        <Link
          to="/upstreams"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Upstreams
        </Link>
      </div>
    );
  }

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
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Edit Upstream Pool: <span className="text-primary font-mono">{initialName}</span>
              </h1>
              {boundDomainsCount > 0 && (
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-muted text-foreground border border-border rounded-full">
                  {boundDomainsCount} bound {boundDomainsCount === 1 ? 'domain' : 'domains'}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Update backend server targets, load balancing, internal SSL (NGINX ➔ Backend), and probe health checks.
            </p>
          </div>
        </div>
      </div>

      {boundDomainsCount > 0 && name.trim().toLowerCase().replace(/\s+/g, '-') !== initialName && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-lg flex items-center gap-2 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            Renaming this upstream will automatically update route bindings for all {boundDomainsCount} connected domain(s).
          </span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-center gap-2 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleUpdate}>
        <div className="grid grid-cols-12 gap-6 items-start">
          {/* Main Form Fields */}
          <div className="col-span-12 lg:col-span-8 space-y-6">
            {/* Section 1: Basic Information */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-xs">
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
                    className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring placeholder:text-muted-foreground font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Unique identifier referenced by edge domain bindings.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Description
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Primary production API microservices"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring placeholder:text-muted-foreground"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Internal documentation notes.</p>
                </div>
              </div>
            </div>

            {/* Section 2: Architecture & Algorithms */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-5 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold text-card-foreground">2. Architecture & Algorithms</h2>
                </div>
              </div>

              {/* Architecture Selection Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  {
                    key: 'Load Balancer',
                    title: 'Load Balancer Pool',
                    desc: 'Multiple backend nodes with weighted load distribution & health monitoring.',
                  },
                  {
                    key: 'Single Server',
                    title: 'Single Server',
                    desc: 'Dedicated single backend host or IP address without load balancer overhead.',
                  },
                  {
                    key: 'External (FQDN)',
                    title: 'External FQDN',
                    desc: 'Direct upstream routing to a dynamic third-party hostname or cloud origin.',
                  },
                ].map((item) => {
                  const selected = type === item.key;
                  return (
                    <div
                      key={item.key}
                      onClick={() => setType(item.key as UpstreamType)}
                      className={`p-3.5 rounded-xl border transition-all duration-150 cursor-pointer text-left ${
                        selected
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'border-border hover:border-primary/40 bg-background/50 hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-foreground">{item.title}</span>
                        {selected && <CheckCircle className="w-3.5 h-3.5 text-primary" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{item.desc}</p>
                    </div>
                  );
                })}
              </div>

              {/* Topology Specific Controls */}
              {type === 'Single Server' && (
                <div className="p-4 bg-muted/20 border border-border rounded-xl space-y-3">
                  <label className="block text-xs font-semibold text-foreground">
                    Backend Address & Port <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="10.0.1.10:8080 or 127.0.0.1:3000"
                    value={singleAddress}
                    onChange={(e) => setSingleAddress(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">Direct host:port address of the target backend service.</p>
                </div>
              )}

              {type === 'Load Balancer' && (
                <div className="space-y-4 pt-1">
                  {/* Algorithm Selector */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { key: 'round_robin', name: 'Round Robin', desc: 'Distribute requests equally by weight' },
                      { key: 'least_conn', name: 'Least Connections', desc: 'Send to server with fewest active requests' },
                      { key: 'ip_hash', name: 'IP Hash (Sticky)', desc: 'Client IP affinity for stateful sessions' },
                    ].map((alg) => {
                      const active = algorithm === alg.key;
                      return (
                        <div
                          key={alg.key}
                          onClick={() => setAlgorithm(alg.key as BalancingAlgorithm)}
                          className={`p-3 rounded-lg border text-left cursor-pointer transition-colors ${
                            active
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border bg-background hover:bg-muted/40'
                          }`}
                        >
                          <div className="text-xs font-semibold text-foreground">{alg.name}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{alg.desc}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Backend Servers Table */}
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-foreground">Backend Servers</label>
                      <button
                        type="button"
                        onClick={addLbServer}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors cursor-pointer"
                      >
                        <Plus className="w-3 h-3" /> Add Server
                      </button>
                    </div>

                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted/40 border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="p-2.5">Address : Port</th>
                            <th className="p-2.5 w-24">Weight</th>
                            <th className="p-2.5 w-24">Max Fails</th>
                            <th className="p-2.5 w-24">Fail Timeout</th>
                            <th className="p-2.5 w-20 text-center">Backup</th>
                            <th className="p-2.5 w-12 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {lbServers.map((srv, idx) => (
                            <tr key={srv.id} className="hover:bg-muted/10">
                              <td className="p-2">
                                <input
                                  type="text"
                                  required
                                  placeholder="10.0.1.10:8080"
                                  value={srv.address}
                                  onChange={(e) => updateLbServer(srv.id, 'address', e.target.value)}
                                  className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  value={srv.weight}
                                  onChange={(e) => updateLbServer(srv.id, 'weight', parseInt(e.target.value) || 1)}
                                  className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground font-mono text-center focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="number"
                                  min="1"
                                  max="10"
                                  value={srv.maxFails || 3}
                                  onChange={(e) => updateLbServer(srv.id, 'maxFails', parseInt(e.target.value) || 3)}
                                  className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground font-mono text-center focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              </td>
                              <td className="p-2">
                                <input
                                  type="text"
                                  value={srv.failTimeout || '10s'}
                                  onChange={(e) => updateLbServer(srv.id, 'failTimeout', e.target.value)}
                                  className="w-full px-2 py-1 text-xs bg-background border border-input rounded text-foreground font-mono text-center focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              </td>
                              <td className="p-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={!!srv.backup}
                                  onChange={(e) => updateLbServer(srv.id, 'backup', e.target.checked)}
                                  className="w-3.5 h-3.5 text-primary rounded border-input focus:ring-ring"
                                />
                              </td>
                              <td className="p-2 text-center">
                                <button
                                  type="button"
                                  disabled={lbServers.length <= 1}
                                  onClick={() => removeLbServer(srv.id)}
                                  className="p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed rounded"
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
                </div>
              )}

              {type === 'External (FQDN)' && (
                <div className="p-4 bg-muted/20 border border-border rounded-xl space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-foreground mb-1.5">
                      Origin Hostname / FQDN <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="origin-alb.internal.amazonaws.com"
                      value={externalFqdn}
                      onChange={(e) => setExternalFqdn(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                    />
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={sniOverride}
                        onChange={(e) => setSniOverride(e.target.checked)}
                        className="w-3.5 h-3.5 text-primary rounded border-input focus:ring-ring"
                      />
                      <span className="font-medium text-foreground">Pass FQDN as SNI Host header (proxy_ssl_server_name)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={dynamicDns}
                        onChange={(e) => setDynamicDns(e.target.checked)}
                        className="w-3.5 h-3.5 text-primary rounded border-input focus:ring-ring"
                      />
                      <span className="font-medium text-foreground">Resolve IP dynamically via local DNS resolver</span>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Section 3: Internal SSL & Backend TLS (NGINX ➔ Backend) */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-5 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <div>
                    <h2 className="text-sm font-semibold text-card-foreground">3. Internal SSL & Backend TLS (NGINX ➔ Backend)</h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Encrypted connection between Aurora WAF and internal origin servers.
                    </p>
                  </div>
                </div>

                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={internalSslEnabled}
                    onChange={(e) => setInternalSslEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              {internalSslEnabled && (
                <div className="space-y-4 pt-1 animate-in fade-in duration-200">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">
                        SNI Host Name (proxy_ssl_name)
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. backend.corp.internal"
                        value={sniHost}
                        onChange={(e) => setSniHost(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">SNI extension sent during TLS handshake to backend.</p>
                    </div>

                    <div className="flex flex-col justify-center space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={verifyCert}
                          onChange={(e) => setVerifyCert(e.target.checked)}
                          className="w-3.5 h-3.5 text-primary rounded border-input focus:ring-ring"
                        />
                        <span className="font-medium text-foreground">Verify Backend SSL Certificate (proxy_ssl_verify on)</span>
                      </label>
                      <p className="text-[11px] text-muted-foreground pl-5.5">
                        Disable to allow self-signed certificates without custom CA bundle.
                      </p>
                    </div>
                  </div>

                  {/* Custom CA Cert */}
                  {verifyCert && (
                    <div className="p-4 bg-muted/20 border border-border rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={customCaEnabled}
                            onChange={(e) => setCustomCaEnabled(e.target.checked)}
                            className="w-3.5 h-3.5 text-primary rounded border-input focus:ring-ring"
                          />
                          <span className="font-medium text-foreground">Provide Custom CA Certificate Bundle</span>
                        </label>
                        <span className="text-[11px] text-muted-foreground">proxy_ssl_trusted_certificate</span>
                      </div>

                      {customCaEnabled && (
                        <CertUploadInput
                          id="ca-cert-upload"
                          label="Custom CA Root / Intermediate Certificate"
                          sublabel="PEM-encoded certificate authority used to sign backend SSL"
                          value={caCert}
                          onChange={setCaCert}
                          fileName={caFileName}
                          onFileNameChange={setCaFileName}
                        />
                      )}
                    </div>
                  )}

                  {/* mTLS Section */}
                  <div className="p-4 bg-muted/20 border border-border rounded-xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Key className="w-3.5 h-3.5 text-primary" />
                          <span>Internal Mutual TLS (mTLS) to Backend</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          NGINX authenticates itself to origin with client certificate.
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={mTLS}
                        onChange={(e) => { setMTLS(e.target.checked); if (e.target.checked) setVerifyCert(true); }}
                        className="w-4 h-4 text-primary rounded border-input focus:ring-ring"
                      />
                    </div>

                    {mTLS && (
                      <div className="space-y-4 pt-2 border-t border-border">
                        <CertUploadInput
                          id="client-cert-upload"
                          label="Client Public Certificate (proxy_ssl_certificate)"
                          sublabel="PEM-encoded public certificate presented to origin backend"
                          value={clientCert}
                          onChange={setClientCert}
                          fileName={clientCertFileName}
                          onFileNameChange={setClientCertFileName}
                        />

                        <CertUploadInput
                          id="client-key-upload"
                          label="Client Private Key (proxy_ssl_certificate_key)"
                          sublabel={clientKeyConfigured ? "Private key is stored. Leave blank to keep it, or upload a matching replacement." : "Upload the unencrypted PEM private key matching the client certificate."}
                          value={clientKey}
                          onChange={setClientKey}
                          fileName={clientKeyFileName}
                          onFileNameChange={setClientKeyFileName}
                          isPrivateKey={true}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Section 4: Health Check Probes */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-xs">
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  <div>
                    <h2 className="text-sm font-semibold text-card-foreground">4. Active Health Check Probes</h2>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Active probes are unavailable in this NGINX runtime. Remove existing probes before saving; passive failure detection remains available.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addProbe}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add Probe
                </button>
              </div>

              <div className="space-y-3">
                {probes.map((probe, idx) => (
                  <div key={probe.id} className="p-3.5 bg-muted/20 border border-border rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground font-mono">Probe #{idx + 1}</span>
                        <select
                          value={probe.type}
                          onChange={(e) => updateProbe(probe.id, 'type', e.target.value)}
                          className="px-2 py-0.5 text-xs bg-background border border-input rounded text-foreground font-medium"
                        >
                          <option value="Health">Health Probe</option>
                          <option value="Readiness">Readiness Probe</option>
                          <option value="Liveness">Liveness Probe</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeProbe(probe.id)}
                        className="p-1 text-muted-foreground hover:text-destructive rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] text-muted-foreground mb-1">HTTP Request Path</label>
                        <input
                          type="text"
                          value={probe.path}
                          onChange={(e) => updateProbe(probe.id, 'path', e.target.value)}
                          placeholder="/healthz"
                          className="w-full px-2.5 py-1.5 text-xs bg-background border border-input rounded text-foreground font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">Expected HTTP Status</label>
                        <input
                          type="number"
                          value={probe.expectedStatus || 200}
                          onChange={(e) => updateProbe(probe.id, 'expectedStatus', parseInt(e.target.value) || 200)}
                          className="w-full px-2.5 py-1.5 text-xs bg-background border border-input rounded text-foreground font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-muted-foreground mb-1">Interval (sec)</label>
                        <input
                          type="number"
                          min="1"
                          value={probe.intervalSec || 5}
                          onChange={(e) => updateProbe(probe.id, 'intervalSec', parseInt(e.target.value) || 5)}
                          className="w-full px-2.5 py-1.5 text-xs bg-background border border-input rounded text-foreground font-mono"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 bg-card border border-border rounded-xl space-y-4">
              <h2 className="text-sm font-semibold">Request compression to upstream</h2>
              <p className="text-xs text-muted-foreground">NGINX forwards already compressed requests unchanged. Creating gzip/deflate request bodies is unavailable; gzip response compression is a separate setting.</p>
              <label className="block text-xs space-y-2">Request body encoding
                {type !== 'External (FQDN)' && <label className="flex items-center gap-2 mb-3 text-xs"><input type="checkbox" checked={dynamicDns} onChange={e => setDynamicDns(e.target.checked)} />Refresh backend DNS every 5 seconds</label>}
                <select aria-label="Request body encoding" value={requestCompression} onChange={e => setRequestCompression(e.target.value as 'none' | 'gzip' | 'deflate')} className="block w-full border border-input bg-background rounded p-2">
                  <option value="none">Off — preserve request</option><option value="gzip" disabled>gzip — unavailable in NGINX</option><option value="deflate" disabled>deflate (zlib)</option>
                </select>
              </label>
              {requestCompression !== 'none' && <div className="grid grid-cols-2 gap-4">
                <label className="text-xs">Minimum body/message size (bytes)<input aria-label="Compression minimum bytes" type="number" min="0" max="1048576" value={compressionMinBytes} onChange={e=>setCompressionMinBytes(Number(e.target.value))} className="block w-full border border-input bg-background rounded p-2" /></label>
                <label className="text-xs">Compression level (1–9)<input aria-label="Compression level" type="number" min="1" max="9" value={compressionLevel} onChange={e=>setCompressionLevel(Number(e.target.value))} className="block w-full border border-input bg-background rounded p-2" /></label>
              </div>}
            </div>

            {/* Section 5: Protocol & Transport Optimization */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-xs">
              <div className="flex items-center gap-2 pb-3 border-b border-border">
                <Zap className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-card-foreground">5. Protocol & Transport Optimization</h2>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    HTTP protocol from node to upstream
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {['HTTP/1.1', 'HTTP/2', 'HTTP/3', 'HTTP/1.0'].map((ver) => (
                      <button type="button"
                        key={ver}
                        disabled={ver === 'HTTP/3'}
                        onClick={() => setHttpVersion(ver as any)}
                        className={`p-2.5 rounded-lg border text-center cursor-pointer text-xs font-mono font-medium transition-colors ${
                          httpVersion === ver
                            ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary'
                            : 'border-border bg-background text-foreground hover:bg-muted/40'
                        }`}
                      >
                        {ver}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-background cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableWebSocket}
                      onChange={(e) => setEnableWebSocket(e.target.checked)}
                      className="w-3.5 h-3.5 text-primary rounded border-input focus:ring-ring"
                    />
                    <span className="text-xs font-medium text-foreground">WebSocket Upgrade</span>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-background cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableSse}
                      onChange={(e) => setEnableSse(e.target.checked)}
                      className="w-3.5 h-3.5 text-primary rounded border-input focus:ring-ring"
                    />
                    <span className="text-xs font-medium text-foreground">Server-Sent Events</span>
                  </label>

                  <label className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-background cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableGrpc}
                      onChange={(e) => { setEnableGrpc(e.target.checked); if (e.target.checked) { setHttpVersion('HTTP/2'); setEnableWebSocket(false); if (requestCompression === 'deflate') setRequestCompression('gzip'); } }}
                      className="w-3.5 h-3.5 text-primary rounded border-input focus:ring-ring"
                    />
                    <span className="text-xs font-medium text-foreground">gRPC Pass-through</span>
                  </label>
                </div>

                <div className="pt-2">
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Idle Keepalive Connections Per Worker (keepalive)
                  </label>
                  <input
                    type="number"
                    min="8"
                    max="1024"
                    value={keepAliveConnections}
                    onChange={(e) => setKeepAliveConnections(parseInt(e.target.value) || 32)}
                    className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Number of idle keepalive connections cached per worker.</p>
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
                disabled={!name.trim() || submitting}
                className="px-5 py-2 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-xs transition-colors cursor-pointer inline-flex items-center gap-2"
              >
                {submitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <span>Save Changes</span>
                )}
              </button>
            </div>
          </div>

          {/* Right Sidebar: Sticky Live Preview */}
          <div className="col-span-12 lg:col-span-4 sticky top-6 space-y-4">
            <div className="p-4 bg-card border border-border rounded-xl space-y-4 shadow-xs">
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
                    <div className="space-y-1">
                      <div className="font-mono text-[11px] text-muted-foreground">Algorithm: {algorithm}</div>
                      <div className="font-medium text-foreground">{lbServers.length} nodes configured</div>
                    </div>
                  )}
                  {type === 'External (FQDN)' && (
                    <span className="font-mono text-foreground block">{externalFqdn || 'origin.internal'}</span>
                  )}
                </div>

                <div className="pt-2 border-t border-border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-muted-foreground text-[11px]">Internal TLS (to BE)</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        internalSslEnabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {internalSslEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  {internalSslEnabled && (
                    <div className="space-y-1 text-[11px] text-muted-foreground">
                      <div className="flex justify-between">
                        <span>Verify Cert:</span>
                        <span className="font-mono">{verifyCert ? 'ON' : 'OFF'}</span>
                      </div>
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
                  <span>Backend transport configuration</span>
                </div>
                <pre className="p-2.5 bg-muted/60 rounded-lg text-[10px] font-mono text-muted-foreground overflow-x-auto leading-relaxed border border-border">
{JSON.stringify({protocol: httpVersion, grpc: enableGrpc, requestCompression, compressionMinBytes, compressionLevel, dynamicDns, tls: internalSslEnabled, verifyOrigin: verifyCert, sni: sniHost, mtls: mTLS, keepAliveConnections}, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
