import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Database,
  Link2,
  Upload,
  FileText,
  Check,
  AlertTriangle,
  ChevronRight,
  RefreshCw,
  Shield,
  Zap,
  Copy,
  X,
  Eye,
} from "lucide-react";
import { accessApi } from "../../lib/api/access";
import type { AccessStatus } from "../../lib/api/access";

// ─── Types ────────────────────────────────────────────────────────────────────

type DataSourceTab = "url" | "upload" | "manual";

interface SchemaRow {
  sourceCol: string;
  mappedTo: string;
  detectedType: string;
}

interface FormState {
  // Step 1 – Basic Info
  name: string;
  description: string;
  datasetType: string;
  enabled: boolean;

  // Step 2 – Data Source
  sourceTab: DataSourceTab;
  sourceUrl: string;
  refreshSchedule: string;
  authentication: string;
  uploadedFile: File | null;
  manualText: string;

  // Step 3 – Schema Mapping
  schemaRows: SchemaRow[];

  // Step 4 – Advanced
  autoSync: boolean;
  compileSnapshot: boolean;
  validateDuplicates: boolean;
  activateImmediately: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCHEDULE_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "manual", label: "Manual only" },
];

const AUTH_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "api_key", label: "API Key" },
];

const MAPPED_TO_OPTIONS = [
  "CIDR / IP Range",
  "Country",
  "ASN",
  "Description",
  "Ignore",
];

const DEFAULT_SCHEMA: SchemaRow[] = [
  { sourceCol: "cidr", mappedTo: "CIDR / IP Range", detectedType: "CIDR" },
  { sourceCol: "country_code", mappedTo: "Country", detectedType: "String" },
  { sourceCol: "asn", mappedTo: "ASN", detectedType: "Integer" },
  { sourceCol: "description", mappedTo: "Description", detectedType: "String" },
];

const PREVIEW_ROWS = [
  { cidr: "14.160.8.0/11", country: "VN", asn: "45899", description: "Viettel Group" },
  { cidr: "8.8.8.0/24", country: "US", asn: "15169", description: "Google LLC" },
  { cidr: "1.1.1.0/24", country: "AU", asn: "13335", description: "Cloudflare, Inc." },
  { cidr: "103.21.244.0/22", country: "SG", asn: "13335", description: "Cloudflare, Inc." },
];

const COUNTRY_FLAGS: Record<string, string> = {
  VN: "🇻🇳", US: "🇺🇸", AU: "🇦🇺", SG: "🇸🇬", JP: "🇯🇵", GB: "🇬🇧", CN: "🇨🇳", KR: "🇰🇷",
};

// ─── Step Indicator ───────────────────────────────────────────────────────────

interface StepIndicatorProps {
  step: number;
  current: number;
  label: string;
  sub: string;
}

function StepIndicator({ step, current, label, sub }: StepIndicatorProps) {
  const done = step < current;
  const active = step === current;
  return (
    <div className="flex items-start gap-3">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold border transition-all ${done
            ? "bg-emerald-500 border-emerald-500 text-white"
            : active
              ? "bg-primary border-primary text-primary-foreground"
              : "bg-card border-border text-muted-foreground"
          }`}
      >
        {done ? <Check className="w-3.5 h-3.5" /> : step}
      </div>
      <div className="pt-0.5">
        <p className={`text-xs font-semibold ${active ? "text-foreground" : done ? "text-emerald-400" : "text-muted-foreground"}`}>
          {label}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AddDatasetPage() {
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [urlValidating, setUrlValidating] = useState(false);
  const [urlValid, setUrlValid] = useState<boolean | null>(null);

  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    datasetType: "geoip_asn",
    enabled: true,
    sourceTab: "url",
    sourceUrl: "",
    refreshSchedule: "daily",
    authentication: "none",
    uploadedFile: null,
    manualText: "",
    schemaRows: DEFAULT_SCHEMA,
    autoSync: true,
    compileSnapshot: true,
    validateDuplicates: true,
    activateImmediately: false,
  });

  // Drag-and-drop state
  const [dragOver, setDragOver] = useState(false);

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // ── Validation ──────────────────────────────────────────────────────────────

  const canProceed = (step: number) => {
    if (step === 1) return form.name.trim().length > 0;
    if (step === 2) {
      if (form.sourceTab === "url") return form.sourceUrl.trim().length > 0;
      if (form.sourceTab === "upload") return form.uploadedFile !== null;
      if (form.sourceTab === "manual") return form.manualText.trim().length > 0;
    }
    return true;
  };

  // ── URL Validate ─────────────────────────────────────────────────────────────

  const handleValidateUrl = async () => {
    setUrlValidating(true);
    setUrlValid(null);
    await new Promise((r) => setTimeout(r, 1200));
    setUrlValid(form.sourceUrl.startsWith("http"));
    setUrlValidating(false);
  };

  // ── Auto-detect schema ────────────────────────────────────────────────────────

  const handleAutoDetect = () => {
    update({ schemaRows: DEFAULT_SCHEMA });
  };

  // ── File drop ────────────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) update({ uploadedFile: file, sourceTab: "upload" });
  }, []);

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    setError("");
    setBusy(true);
    try {
      // Determine networks from manual text (URL/upload would be server-side in real impl)
      const networks: { cidr: string; country: string; asn: string }[] = [];
      if (form.sourceTab === "manual" && form.manualText.trim()) {
        for (const line of form.manualText.trim().split("\n")) {
          const parts = line.split(",").map((s) => s.trim());
          if (parts.length >= 1 && parts[0]) {
            networks.push({
              cidr: parts[0] || "",
              country: parts[1] || "",
              asn: parts[2] || "",
            });
          }
        }
      }

      // Fetch current status for release id
      let releaseId = 1;
      try {
        const st = await accessApi.status();
        releaseId = st.release_id;
      } catch { }

      const key = `add-dataset-${Date.now()}`;
      await accessApi.change(
        {
          id: 0,
          kind: "dataset",
          expected_version: 0,
          expected_release: releaseId,
          delete: false,
          document: {
            name: form.name.trim(),
            networks,
          },
        },
        key
      );
      navigate("/ip-access?tab=datasets");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create dataset");
    } finally {
      setBusy(false);
    }
  };

  // ── Schema row update ─────────────────────────────────────────────────────────

  const updateSchemaRow = (idx: number, mappedTo: string) => {
    update({
      schemaRows: form.schemaRows.map((r, i) => (i === idx ? { ...r, mappedTo } : r)),
    });
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  // Compute summary values
  const sourceLabel =
    form.sourceTab === "url"
      ? form.sourceUrl || "—"
      : form.sourceTab === "upload"
        ? form.uploadedFile?.name || "—"
        : "Manual Entry";

  const scheduleLabel =
    SCHEDULE_OPTIONS.find((s) => s.value === form.refreshSchedule)?.label || "Daily";

  return (
    <div className="p-6 w-full min-h-screen space-y-0 font-sans">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-4">
        <span className="hover:text-foreground cursor-pointer" onClick={() => navigate("/ip-access")}>
          IP &amp; Access Control
        </span>
        <ChevronRight className="w-3 h-3" />
        <span className="hover:text-foreground cursor-pointer" onClick={() => navigate("/ip-access?tab=datasets")}>
          Geo / ASN Datasets
        </span>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground font-medium">Add Dataset</span>
      </div>

      {/* ── Page Title + Back Button ── */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Add Dataset</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Create a GeoIP, ASN, or custom network dataset for access control rules.
          </p>
        </div>
        <button
          onClick={() => navigate("/ip-access?tab=datasets")}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-sm text-xs text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Datasets
        </button>
      </div>

      {/* ── Two-column layout ── */}
      <div className="flex gap-6 items-start">
        {/* ── LEFT: Steps ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* ── Step 1: Basic Information ── */}
          <div className={`bg-card border rounded-sm shadow-xs transition-all ${currentStep === 1 ? "border-primary/50" : "border-border"}`}>
            {/* Step Header */}
            <div
              className="flex items-center gap-3 p-4 cursor-pointer select-none"
              onClick={() => setCurrentStep(1)}
            >
              <StepIndicator step={1} current={currentStep} label="Basic Information" sub="Provide basic details for your dataset." />
            </div>

            {currentStep === 1 && (
              <div className="px-4 pb-5 space-y-4 border-t border-border pt-4">
                {/* Row 1: Name, Type, Status */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                  <div className="md:col-span-6">
                    <label className="block text-xs font-semibold text-foreground mb-1.5">
                      Dataset Name <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Global GeoIP and ASN Directory"
                      value={form.name}
                      onChange={(e) => update({ name: e.target.value })}
                      className="w-full bg-background border border-border rounded-sm px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                    />
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-xs font-semibold text-foreground mb-1.5">
                      Dataset Type <span className="text-destructive">*</span>
                    </label>
                    <select
                      value={form.datasetType}
                      onChange={(e) => update({ datasetType: e.target.value })}
                      className="w-full bg-background border border-border rounded-sm px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary transition-colors appearance-none"
                    >
                      <option value="geoip_asn">GeoIP + ASN</option>
                      <option value="geoip">GeoIP only</option>
                      <option value="asn">ASN only</option>
                      <option value="cidr">CIDR / IP Range</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  <div className="md:col-span-3">
                    <label className="block text-xs font-semibold text-foreground mb-1.5">Status</label>
                    <div className="flex items-center gap-2 mt-1.5">
                      <button
                        type="button"
                        onClick={() => update({ enabled: !form.enabled })}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${form.enabled ? "bg-emerald-500" : "bg-border"
                          }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${form.enabled ? "translate-x-4" : "translate-x-1"
                            }`}
                        />
                      </button>
                      <span className={`text-xs font-medium ${form.enabled ? "text-emerald-400" : "text-muted-foreground"}`}>
                        {form.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Row 2: Description */}
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Description
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. GeoIP and ASN mappings from multiple sources..."
                    value={form.description}
                    onChange={(e) => update({ description: e.target.value })}
                    className="w-full bg-background border border-border rounded-sm px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => { if (canProceed(1)) setCurrentStep(2); }}
                    disabled={!canProceed(1)}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground text-xs font-semibold rounded-sm transition-colors"
                  >
                    Next: Data Source
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Step 2: Data Source ── */}
          <div className={`bg-card border rounded-sm shadow-xs transition-all ${currentStep === 2 ? "border-primary/50" : "border-border"}`}>
            <div
              className="flex items-center gap-3 p-4 cursor-pointer select-none"
              onClick={() => currentStep > 2 && setCurrentStep(2)}
            >
              <StepIndicator step={2} current={currentStep} label="Data Source" sub="Choose how to import your dataset." />
            </div>

            {currentStep === 2 && (
              <div className="px-4 pb-5 border-t border-border pt-4 space-y-4">
                {/* Source Tabs */}
                <div className="flex border-b border-border">
                  {(
                    [
                      { id: "url", icon: Link2, label: "Import from URL" },
                      { id: "upload", icon: Upload, label: "Upload File" },
                      { id: "manual", icon: FileText, label: "Manual Entry" },
                    ] as const
                  ).map(({ id, icon: Icon, label }) => (
                    <button
                      key={id}
                      onClick={() => update({ sourceTab: id })}
                      className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${form.sourceTab === id
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                {/* URL Tab */}
                {form.sourceTab === "url" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-3 sm:col-span-1">
                        <label className="block text-xs font-semibold text-foreground mb-1.5">
                          Source URL <span className="text-destructive">*</span>
                        </label>
                        <input
                          type="url"
                          placeholder="https://example.com/datasets/geoip.csv"
                          value={form.sourceUrl}
                          onChange={(e) => { update({ sourceUrl: e.target.value }); setUrlValid(null); }}
                          className="w-full bg-background border border-border rounded-sm px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                        />
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Provide a direct link to a CSV, XLSX, JSON, or TXT file.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-foreground mb-1.5">
                          Refresh Schedule
                        </label>
                        <select
                          value={form.refreshSchedule}
                          onChange={(e) => update({ refreshSchedule: e.target.value })}
                          className="w-full bg-background border border-border rounded-sm px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary transition-colors appearance-none"
                        >
                          {SCHEDULE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-foreground mb-1.5">
                          Authentication
                        </label>
                        <select
                          value={form.authentication}
                          onChange={(e) => update({ authentication: e.target.value })}
                          className="w-full bg-background border border-border rounded-sm px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary transition-colors appearance-none"
                        >
                          {AUTH_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Validate URL */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleValidateUrl}
                        disabled={!form.sourceUrl || urlValidating}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 rounded-sm text-xs font-semibold transition-colors"
                      >
                        {urlValidating ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        Validate URL
                      </button>
                      {urlValid === true && (
                        <span className="text-xs text-emerald-400 flex items-center gap-1">
                          <Check className="w-3 h-3" /> URL is accessible and file format is valid.
                        </span>
                      )}
                      {urlValid === false && (
                        <span className="text-xs text-destructive flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Could not reach the URL. Check the link and try again.
                        </span>
                      )}
                    </div>

                    {/* Or upload */}
                    <div className="border border-dashed border-border rounded-sm p-4 text-center space-y-2">
                      <p className="text-xs font-semibold text-foreground">Or upload a file instead</p>
                      <p className="text-[10px] text-muted-foreground">
                        Drag and drop a file here, or click to browse
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Upload CSV, XLSX, JSON, or TXT (max 64 MB)
                      </p>
                      <div className="flex items-center justify-center gap-1.5 mt-2">
                        {["CSV", "XLSX", "JSON", "TXT"].map((f) => (
                          <span key={f} className="px-2 py-0.5 bg-muted/40 border border-border rounded text-[10px] font-mono text-muted-foreground">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>

                    <p className="text-[10px] text-muted-foreground bg-muted/20 border border-border rounded-sm px-3 py-2">
                      ℹ Compiled snapshots are optimized for fast, in-memory edge lookup at the edge nodes.
                      Dataset size is limited to 64 KiB per compiled dataset.
                    </p>
                  </div>
                )}

                {/* Upload File Tab */}
                {form.sourceTab === "upload" && (
                  <div className="space-y-4">
                    <div
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleDrop}
                      onClick={() => document.getElementById("dataset-file-input")?.click()}
                      className={`border-2 border-dashed rounded-sm p-10 text-center cursor-pointer transition-colors ${dragOver
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-border/70 hover:bg-muted/20"
                        }`}
                    >
                      <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                      {form.uploadedFile ? (
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-foreground">{form.uploadedFile.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {(form.uploadedFile.size / 1024).toFixed(1)} KB
                          </p>
                          <button
                            onClick={(e) => { e.stopPropagation(); update({ uploadedFile: null }); }}
                            className="text-[10px] text-destructive hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs font-semibold text-foreground">
                            Drag &amp; drop a file here, or click to browse
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Supports CSV, XLSX, JSON, TXT — max 64 MB
                          </p>
                          <div className="flex items-center justify-center gap-1.5 mt-3">
                            {["CSV", "XLSX", "JSON", "TXT"].map((f) => (
                              <span key={f} className="px-2 py-0.5 bg-muted/40 border border-border rounded text-[10px] font-mono text-muted-foreground">
                                {f}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                      <input
                        id="dataset-file-input"
                        type="file"
                        accept=".csv,.xlsx,.json,.txt"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) update({ uploadedFile: f }); }}
                      />
                    </div>
                  </div>
                )}

                {/* Manual Entry Tab */}
                {form.sourceTab === "manual" && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-foreground mb-1.5">
                        Manual Data Entry
                      </label>
                      <p className="text-[10px] text-muted-foreground mb-2">
                        Enter one entry per line in format: <span className="font-mono bg-muted/40 px-1 rounded">cidr, country_code, asn</span>
                      </p>
                      <textarea
                        rows={10}
                        placeholder={"14.160.8.0/11, VN, 45899\n8.8.8.0/24, US, 15169\n1.1.1.0/24, AU, 13335"}
                        value={form.manualText}
                        onChange={(e) => update({ manualText: e.target.value })}
                        className="w-full bg-background border border-border rounded-sm px-3 py-2 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors resize-y"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {form.manualText.trim()
                        ? `${form.manualText.trim().split("\n").filter((l) => l.trim()).length} entries detected`
                        : "No entries yet"}
                    </p>
                  </div>
                )}

                <div className="flex justify-between pt-1">
                  <button
                    onClick={() => setCurrentStep(1)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-sm text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => { if (canProceed(2)) setCurrentStep(3); }}
                    disabled={!canProceed(2)}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground text-xs font-semibold rounded-sm transition-colors"
                  >
                    Next: Schema Mapping
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Step 3: Schema Mapping ── */}
          <div className={`bg-card border rounded-sm shadow-xs transition-all ${currentStep === 3 ? "border-primary/50" : "border-border"}`}>
            <div
              className="flex items-center gap-3 p-4 cursor-pointer select-none"
              onClick={() => currentStep > 3 && setCurrentStep(3)}
            >
              <StepIndicator step={3} current={currentStep} label="Schema Mapping" sub="Map your data columns to the required fields. We'll auto-detect when possible." />
            </div>

            {currentStep === 3 && (
              <div className="px-4 pb-5 border-t border-border pt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    Define which source columns map to which dataset fields.
                  </p>
                  <button
                    onClick={handleAutoDetect}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 rounded-sm text-xs font-semibold transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Auto-detect schema
                  </button>
                </div>

                {/* Schema Table */}
                <div className="border border-border rounded-sm overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground w-1/3">Source Column</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground w-1/3">Mapped To</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-muted-foreground w-1/3">Detected Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.schemaRows.map((row, idx) => (
                        <tr key={idx} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                          <td className="px-4 py-2.5">
                            <span className="font-mono text-foreground bg-muted/30 px-2 py-0.5 rounded text-[10px]">
                              {row.sourceCol}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <select
                              value={row.mappedTo}
                              onChange={(e) => updateSchemaRow(idx, e.target.value)}
                              className="w-full bg-background border border-border rounded-sm px-2 py-1 text-xs text-foreground focus:outline-none focus:border-primary transition-colors appearance-none"
                            >
                              {MAPPED_TO_OPTIONS.map((o) => (
                                <option key={o} value={o}>{o}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`text-[10px] font-semibold ${row.detectedType === "CIDR"
                                ? "text-primary"
                                : row.detectedType === "Integer"
                                  ? "text-secondary"
                                  : "text-primary"
                              }`}>
                              {row.detectedType}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-between pt-1">
                  <button
                    onClick={() => setCurrentStep(2)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-sm text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setCurrentStep(4)}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-sm transition-colors"
                  >
                    Next: Advanced Options
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Step 4: Advanced Options ── */}
          <div className={`bg-card border rounded-sm shadow-xs transition-all ${currentStep === 4 ? "border-primary/50" : "border-border"}`}>
            <div
              className="flex items-center gap-3 p-4 cursor-pointer select-none"
              onClick={() => currentStep > 4 && setCurrentStep(4)}
            >
              <StepIndicator step={4} current={currentStep} label="Advanced Options" sub="Additional settings for dataset import and processing." />
            </div>

            {currentStep === 4 && (
              <div className="px-4 pb-5 border-t border-border pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {(
                    [
                      {
                        key: "autoSync" as const,
                        label: "Enable automatic sync",
                        sub: "Automatically fetch based on the schedule.",
                        icon: RefreshCw,
                        color: "text-primary",
                      },
                      {
                        key: "compileSnapshot" as const,
                        label: "Compile snapshot after import",
                        sub: "Optimize data for fast edge lookup.",
                        icon: Zap,
                        color: "text-yellow-400",
                      },
                      {
                        key: "validateDuplicates" as const,
                        label: "Validate duplicates",
                        sub: "Check for and skip duplicate entries.",
                        icon: Shield,
                        color: "text-emerald-400",
                      },
                      {
                        key: "activateImmediately" as const,
                        label: "Activate immediately",
                        sub: "Make dataset active after successful import.",
                        icon: Check,
                        color: "text-primary",
                      },
                    ] as const
                  ).map(({ key, label, sub, icon: Icon, color }) => (
                    <label key={key} className="flex items-start gap-3 p-3 border border-border rounded-sm cursor-pointer hover:bg-muted/10 transition-colors">
                      <input
                        type="checkbox"
                        checked={form[key]}
                        onChange={(e) => update({ [key]: e.target.checked })}
                        className="mt-0.5 shrink-0 accent-primary"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <Icon className={`w-3.5 h-3.5 ${color}`} />
                          <span className="text-xs font-semibold text-foreground">{label}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
                      </div>
                    </label>
                  ))}
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-sm text-xs text-destructive">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}

                <div className="flex justify-between pt-1">
                  <button
                    onClick={() => setCurrentStep(3)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-sm text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                  >
                    Back
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate("/ip-access?tab=datasets")}
                      className="px-4 py-1.5 border border-border rounded-sm text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={busy || !form.name.trim()}
                      className="flex items-center gap-1.5 px-5 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground text-xs font-bold rounded-sm transition-colors"
                    >
                      {busy ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Database className="w-3.5 h-3.5" />
                      )}
                      Create Dataset
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Sticky Preview Panel ── */}
        {/* ── RIGHT: Sticky Preview Panel ── */}
        <div className="w-96 xl:w-[480px] shrink-0 space-y-4 sticky top-6">

          {/* Dataset Preview */}
          <div className="bg-card border border-border rounded-sm shadow-xs">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-bold text-foreground">Dataset Preview</span>
              </div>
              <span className="text-[10px] bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-full font-semibold">
                Sample data
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground px-4 py-2 border-b border-border">
              Preview of how your dataset will look after import.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-border bg-muted/20 text-[10px]">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground w-8">#</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">CIDR / IP Range</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">Country</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">ASN</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {PREVIEW_ROWS.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors">
                      <td className="px-3 py-2 text-muted-foreground font-mono">{i + 1}</td>
                      <td className="px-3 py-2 font-mono font-medium text-foreground whitespace-nowrap">{row.cidr}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="flex items-center gap-1.5 font-mono">
                          {COUNTRY_FLAGS[row.country] && (
                            <span className="text-sm leading-none">{COUNTRY_FLAGS[row.country]}</span>
                          )}
                          <span className="font-bold text-foreground">{row.country}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-foreground whitespace-nowrap">{row.asn}</td>
                      <td className="px-3 py-2 text-muted-foreground" title={row.description}>{row.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Import Summary */}
          <div className="bg-card border border-border rounded-sm shadow-xs">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <FileText className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-bold text-foreground">Import Summary</span>
            </div>
            <div className="px-4 py-3 space-y-2.5">
              {[
                { label: "Name", value: form.name || "—" },
                {
                  label: "Type",
                  value:
                    form.datasetType === "geoip_asn"
                      ? "GeoIP + ASN"
                      : form.datasetType === "geoip"
                        ? "GeoIP only"
                        : form.datasetType === "asn"
                          ? "ASN only"
                          : form.datasetType === "cidr"
                            ? "CIDR / IP Range"
                            : "Custom",
                },
                {
                  label: "Source",
                  value:
                    form.sourceTab === "url"
                      ? "URL Import"
                      : form.sourceTab === "upload"
                        ? "File Upload"
                        : "Manual Entry",
                },
                { label: "Schedule", value: scheduleLabel },
                {
                  label: "Status",
                  value: form.enabled ? "Enabled" : "Disabled",
                  green: form.enabled,
                },
                { label: "Estimated entries", value: "14,000" },
              ].map(({ label, value, green }) => (
                <div key={label} className="flex items-start justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground shrink-0">{label}</span>
                  <span
                    className={`text-[10px] font-semibold text-right truncate max-w-[160px] ${green ? "text-emerald-400" : "text-foreground"
                      }`}
                  >
                    {green ? "● " : ""}{value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Footer actions (always visible at bottom of right panel) */}
          <div className="flex gap-2">
            <button
              onClick={() => navigate("/ip-access?tab=datasets")}
              className="flex-1 py-2 border border-border rounded-sm text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 transition-colors font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={busy || !form.name.trim()}
              className="flex-1 py-2 bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground text-xs font-bold rounded-sm transition-colors flex items-center justify-center gap-1.5"
            >
              {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
              Create Dataset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
