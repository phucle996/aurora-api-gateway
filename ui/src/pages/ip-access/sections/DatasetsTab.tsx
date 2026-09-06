import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Globe,
  Database,
  Plus,
  Search,
  History,
  Trash2,
  Upload,
  X,
  Check,
  AlertTriangle,
  FileText,
  HelpCircle,
  Eye,
  ChevronDown,
  ChevronUp,
  Download,
  ArrowRight,
} from "lucide-react";
import type {
  AccessObject,
  AccessStatus,
  AccessChange,
  AccessDatasetDocument,
} from "../../../lib/api/access";

interface DatasetsTabProps {
  items: AccessObject[];
  busy: boolean;
  status: AccessStatus | null;
  onChange: (command: AccessChange) => Promise<void>;
  onSelectHistory: (item: AccessObject) => void;
}

const ASN_ORG_MAP: Record<string, string> = {
  "45899": "VNPT Group",
  "7552": "Viettel Group",
  "18403": "FPT Telecom",
  "13335": "Cloudflare, Inc.",
  "15169": "Google LLC",
  "2516": "KDDI Corporation",
  "4713": "NTT Communications",
  "9370": "Sakura Internet",
  "4657": "Singtel Global",
  "8048": "CANTV Venezuela",
  "7303": "Telecom Argentina",
  "8447": "A1 Telekom Austria",
  "6752": "Servei de Telecommunicacions d\x27Andorra",
  "3215": "Orange S.A.",
  "24545": "Telecom Samoa / Pacific",
  "27775": "SETAR N.V. Aruba",
  "16174": "Alands Telekommunikation",
  "29049": "Delta Telecom Azerbaijan",
  "5384": "Emirates Telecom (Etisalat)",
  "55330": "Afghan Telecom",
  "36040": "Cable & Wireless Caribbean",
  "40263": "Caribbean Telecommunications",
  "44034": "Albtelecom Sh.a.",
  "49800": "Telecom Armenia",
  "36907": "Angola Telecom",
  "37054": "Econet Wireless Africa",
  "37497": "Liquid Intelligent Technologies",
  "30873": "TeleYemen",
};

interface CountryInfo {
  nameEn: string;
  nameVi?: string;
  searchKeywords?: string[];
}

const COUNTRY_DICT: Record<string, CountryInfo> = {
  VN: { nameEn: "Vietnam", nameVi: "Việt Nam", searchKeywords: ["Viet Nam", "Vietnam", "Việt Nam", "VN"] },
  US: { nameEn: "United States", nameVi: "Hoa Kỳ", searchKeywords: ["USA", "America", "Mỹ", "Hoa Kỳ", "US"] },
  JP: { nameEn: "Japan", nameVi: "Nhật Bản", searchKeywords: ["Nhat Ban", "Nhật", "JP"] },
  SG: { nameEn: "Singapore", nameVi: "Singapore", searchKeywords: ["Sing", "SG"] },
  KR: { nameEn: "South Korea", nameVi: "Hàn Quốc", searchKeywords: ["Korea", "Han Quoc", "Hàn", "KR"] },
  CN: { nameEn: "China", nameVi: "Trung Quốc", searchKeywords: ["Trung Quoc", "Trung", "TQ", "CN"] },
  TW: { nameEn: "Taiwan", nameVi: "Đài Loan", searchKeywords: ["Dai Loan", "TW"] },
  HK: { nameEn: "Hong Kong", nameVi: "Hồng Kông", searchKeywords: ["Hong Kong", "Hồng Kông", "HK"] },
  TH: { nameEn: "Thailand", nameVi: "Thái Lan", searchKeywords: ["Thai Lan", "Thái", "TH"] },
  MY: { nameEn: "Malaysia", nameVi: "Malaysia", searchKeywords: ["Mã Lai", "MY"] },
  ID: { nameEn: "Indonesia", nameVi: "Indonesia", searchKeywords: ["Nam Dương", "ID"] },
  PH: { nameEn: "Philippines", nameVi: "Philippines", searchKeywords: ["Phi Luật Tân", "PH"] },
  IN: { nameEn: "India", nameVi: "Ấn Độ", searchKeywords: ["An Do", "Ấn", "IN"] },
  AU: { nameEn: "Australia", nameVi: "Úc", searchKeywords: ["Uc", "Nước Úc", "AU"] },
  GB: { nameEn: "United Kingdom", nameVi: "Vương quốc Anh", searchKeywords: ["UK", "Britain", "England", "Anh", "GB"] },
  DE: { nameEn: "Germany", nameVi: "Đức", searchKeywords: ["Duc", "Đức", "DE"] },
  FR: { nameEn: "France", nameVi: "Pháp", searchKeywords: ["Phap", "Pháp", "FR"] },
  CA: { nameEn: "Canada", nameVi: "Canada", searchKeywords: ["Gia Nã Đại", "CA"] },
  NL: { nameEn: "Netherlands", nameVi: "Hà Lan", searchKeywords: ["Ha Lan", "Holland", "NL"] },
  RU: { nameEn: "Russia", nameVi: "Nga", searchKeywords: ["Liên Bang Nga", "RU"] },
  BR: { nameEn: "Brazil", nameVi: "Brazil", searchKeywords: ["Bra-xin", "BR"] },
  IT: { nameEn: "Italy", nameVi: "Ý", searchKeywords: ["Italia", "Nuoc Y", "IT"] },
  ES: { nameEn: "Spain", nameVi: "Tây Ban Nha", searchKeywords: ["Tay Ban Nha", "ES"] },
  CH: { nameEn: "Switzerland", nameVi: "Thụy Sĩ", searchKeywords: ["Thuy Si", "CH"] },
  SE: { nameEn: "Sweden", nameVi: "Thụy Điển", searchKeywords: ["Thuy Dien", "SE"] },
  NO: { nameEn: "Norway", nameVi: "Na Uy", searchKeywords: ["Na Uy", "NO"] },
  DK: { nameEn: "Denmark", nameVi: "Đan Mạch", searchKeywords: ["Dan Mach", "DK"] },
  FI: { nameEn: "Finland", nameVi: "Phần Lan", searchKeywords: ["Phan Lan", "FI"] },
  PL: { nameEn: "Poland", nameVi: "Ba Lan", searchKeywords: ["Ba Lan", "PL"] },
  UA: { nameEn: "Ukraine", nameVi: "Ukraina", searchKeywords: ["U-crai-na", "UA"] },
  TR: { nameEn: "Turkey", nameVi: "Thổ Nhĩ Kỳ", searchKeywords: ["Tho Nhi Ky", "Turkiye", "TR"] },
  SA: { nameEn: "Saudi Arabia", nameVi: "Ả Rập Xê Út", searchKeywords: ["A Rap Xe Ut", "SA"] },
  AE: { nameEn: "United Arab Emirates", nameVi: "Các Tiểu Vương Quốc Ả Rập Thống Nhất", searchKeywords: ["UAE", "Dubai", "AE"] },
  IL: { nameEn: "Israel", nameVi: "Israel", searchKeywords: ["Do Thái", "IL"] },
  ZA: { nameEn: "South Africa", nameVi: "Nam Phi", searchKeywords: ["Nam Phi", "ZA"] },
  EG: { nameEn: "Egypt", nameVi: "Ai Cập", searchKeywords: ["Ai Cap", "EG"] },
  AR: { nameEn: "Argentina", nameVi: "Argentina", searchKeywords: ["Ác-hen-ti-na", "AR"] },
  CL: { nameEn: "Chile", nameVi: "Chile", searchKeywords: ["Chi-lê", "CL"] },
  MX: { nameEn: "Mexico", nameVi: "Mexico", searchKeywords: ["Mễ Tây Cơ", "MX"] },
  NZ: { nameEn: "New Zealand", nameVi: "New Zealand", searchKeywords: ["Tân Tây Lan", "NZ"] },
  IE: { nameEn: "Ireland", nameVi: "Ireland", searchKeywords: ["Ai-len", "IE"] },
  BE: { nameEn: "Belgium", nameVi: "Bỉ", searchKeywords: ["Bi", "Nuoc Bi", "BE"] },
  AT: { nameEn: "Austria", nameVi: "Áo", searchKeywords: ["Ao", "Nuoc Ao", "AT"] },
  PT: { nameEn: "Portugal", nameVi: "Bồ Đào Nha", searchKeywords: ["Bo Dao Nha", "PT"] },
  GR: { nameEn: "Greece", nameVi: "Hy Lạp", searchKeywords: ["Hy Lap", "GR"] },
  CZ: { nameEn: "Czech Republic", nameVi: "Cộng hòa Séc", searchKeywords: ["Sec", "Czech", "CZ"] },
  HU: { nameEn: "Hungary", nameVi: "Hungary", searchKeywords: ["Hung-ga-ri", "HU"] },
  RO: { nameEn: "Romania", nameVi: "Romania", searchKeywords: ["Ru-ma-ni", "RO"] },
  KH: { nameEn: "Cambodia", nameVi: "Campuchia", searchKeywords: ["Campuchia", "Cam Pu Chia", "KH"] },
  LA: { nameEn: "Laos", nameVi: "Lào", searchKeywords: ["Nuoc Lao", "LA"] },
  MM: { nameEn: "Myanmar", nameVi: "Myanmar", searchKeywords: ["Miến Điện", "Burma", "MM"] },
};

const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_DICT).map(([code, info]) => [code, info.nameEn])
);

function getCountryFullName(countryCode?: string): string {
  if (!countryCode) return "";
  const code = countryCode.toUpperCase();
  const info = COUNTRY_DICT[code];
  if (!info) return code;
  if (info.nameVi && info.nameVi.toLowerCase() !== info.nameEn.toLowerCase()) {
    return `${info.nameEn} (${info.nameVi})`;
  }
  return info.nameEn;
}

function normalizeSearchText(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .trim();
}

function matchCountrySearch(countryCode: string | undefined, query: string): boolean {
  if (!countryCode || !query) return false;
  const code = countryCode.toUpperCase();
  const rawQ = query.trim().toLowerCase();
  const normQ = normalizeSearchText(query);
  const normQNoSpaces = normQ.replace(/\s+/g, "");

  if (code.toLowerCase().includes(rawQ) || code.toLowerCase().includes(normQ)) {
    return true;
  }

  const info = COUNTRY_DICT[code];
  if (!info) {
    return false;
  }

  const normEn = normalizeSearchText(info.nameEn);
  if (
    info.nameEn.toLowerCase().includes(rawQ) ||
    normEn.includes(normQ) ||
    normEn.replace(/\s+/g, "").includes(normQNoSpaces)
  ) {
    return true;
  }

  if (info.nameVi) {
    const normVi = normalizeSearchText(info.nameVi);
    if (
      info.nameVi.toLowerCase().includes(rawQ) ||
      normVi.includes(normQ) ||
      normVi.replace(/\s+/g, "").includes(normQNoSpaces)
    ) {
      return true;
    }
  }

  if (info.searchKeywords) {
    for (const kw of info.searchKeywords) {
      const normKw = normalizeSearchText(kw);
      if (
        kw.toLowerCase().includes(rawQ) ||
        normKw.includes(normQ) ||
        normKw.replace(/\s+/g, "").includes(normQNoSpaces)
      ) {
        return true;
      }
    }
  }

  return false;
}

function getCountryFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  const codePoints = countryCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function getNetworkDescription(net: { cidr: string; country: string; asn: string }): string {
  const cleanAsn = net.asn?.replace(/^AS/i, "");
  if (cleanAsn && ASN_ORG_MAP[cleanAsn]) {
    return ASN_ORG_MAP[cleanAsn];
  }
  const countryKey = net.country ? net.country.toUpperCase() : "";
  if (countryKey && COUNTRY_DICT[countryKey]) {
    return `${COUNTRY_DICT[countryKey].nameEn} Telecom / ISP`;
  }
  if (net.country) {
    return `${countryKey} National IP Subnet`;
  }
  return "Global Autonomous Network";
}

function formatDatasetDate(dateStr?: string): string {
  if (!dateStr) return "Recently";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "Recently";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "Recently";
  }
}

export function DatasetsTab({
  items,
  busy,
  status,
  onChange,
  onSelectHistory,
}: DatasetsTabProps) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "both" | "country" | "asn">("all");
  const [collapsedPreviews, setCollapsedPreviews] = useState<Record<number, boolean>>({});

  // View All Modal
  const [viewAllItem, setViewAllItem] = useState<AccessObject | null>(null);
  const [viewSearch, setViewSearch] = useState("");
  const [viewPage, setViewPage] = useState(1);

  // Editor Modal
  const [editor, setEditor] = useState<{
    id: number;
    version: number;
    release: number;
    name: string;
    text: string;
  } | null>(null);
  const [formError, setFormError] = useState("");

  // Delete Confirmation Modal
  const [deleteTarget, setDeleteTarget] = useState<AccessObject | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const datasets = items.filter((x) => x.kind === "dataset");

  const filtered = datasets.filter((d) => {
    const doc = d.document as AccessDatasetDocument;
    const networks = doc.networks || [];

    // Type filter
    if (typeFilter === "both") {
      const hasCountry = networks.some((n) => Boolean(n.country));
      const hasAsn = networks.some((n) => Boolean(n.asn));
      if (!hasCountry || !hasAsn) return false;
    } else if (typeFilter === "country") {
      const hasCountry = networks.some((n) => Boolean(n.country));
      if (!hasCountry) return false;
    } else if (typeFilter === "asn") {
      const hasAsn = networks.some((n) => Boolean(n.asn));
      if (!hasAsn) return false;
    }

    // Search filter
    if (!search.trim()) return true;
    const rawQ = search.trim().toLowerCase();
    const normQ = normalizeSearchText(search);
    const nameMatch =
      doc.name.toLowerCase().includes(rawQ) ||
      normalizeSearchText(doc.name).includes(normQ);
    const netMatch = networks.some((n) => {
      const cidrMatch = n.cidr.toLowerCase().includes(rawQ);
      const countryMatch = matchCountrySearch(n.country, search);
      const asnMatch =
        n.asn.toLowerCase().includes(rawQ) ||
        n.asn.replace(/^AS/i, "").includes(rawQ);
      const desc = getNetworkDescription(n);
      const descMatch =
        desc.toLowerCase().includes(rawQ) ||
        normalizeSearchText(desc).includes(normQ);
      return cidrMatch || countryMatch || asnMatch || descMatch;
    });
    return nameMatch || netMatch;
  });

  const togglePreview = (id: number) => {
    setCollapsedPreviews((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleOpenCreate = () => {
    navigate("/ip-access/datasets/new");
  };

  const handleOpenEdit = (item: AccessObject) => {
    setFormError("");
    const doc = item.document as AccessDatasetDocument;
    const text = (doc.networks || [])
      .map((n) => `${n.cidr}, ${n.country}, ${n.asn}`)
      .join("\n");

    setEditor({
      id: item.id,
      version: item.version,
      release: status ? status.release_id : 1,
      name: doc.name || "",
      text,
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 65536) {
      setFormError("Dataset file exceeds maximum 64 KB boundary.");
      return;
    }
    try {
      const content = await file.text();
      setEditor((prev) => (prev ? { ...prev, text: content } : null));
      setFormError("");
    } catch (err) {
      setFormError(`Failed to read file: ${String(err)}`);
    }
  };

  const handleLoadFullIsoDataset = async () => {
    try {
      const res = await fetch("/datasets/iso-3166-countries.csv");
      if (!res.ok) throw new Error("Could not fetch ISO dataset template");
      const text = await res.text();
      setEditor((prev) =>
        prev
          ? {
              ...prev,
              name: prev.name || "Global ISO-3166 GeoIP & ASN Directory",
              text: text.trim(),
            }
          : null
      );
      setFormError("");
    } catch (err) {
      setFormError(`Failed to load template: ${String(err)}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor) return;
    setFormError("");

    try {
      const lines = editor.text
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      if (lines.length === 0) {
        setFormError("Please provide at least one dataset mapping line.");
        return;
      }

      const networks = lines.map((line, idx) => {
        const parts = line.split(",").map((s) => s.trim());
        if (parts.length < 1) {
          throw new Error(`Line ${idx + 1}: Invalid format.`);
        }
        const [cidr, country = "", asn = "", ...extra] = parts;
        if (extra.length > 0) {
          throw new Error(`Line ${idx + 1}: Expected format "CIDR, CountryCode, ASN"`);
        }
        return { cidr, country: country.toUpperCase(), asn: asn.toUpperCase() };
      });

      await onChange({
        id: editor.id,
        kind: "dataset",
        expected_version: editor.version,
        expected_release: editor.release,
        delete: false,
        document: {
          name: editor.name.trim(),
          networks,
        },
      });

      setEditor(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmDeleteDataset = async () => {
    if (!deleteTarget || !status) return;

    try {
      setDeleteBusy(true);
      await onChange({
        id: deleteTarget.id,
        kind: "dataset",
        expected_version: deleteTarget.version,
        expected_release: status.release_id,
        delete: true,
        document: null,
      });
      setDeleteTarget(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleExportCsv = (dataset: AccessDatasetDocument) => {
    const lines = (dataset.networks || []).map(
      (n) => `${n.cidr}, ${n.country}, ${n.asn}`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dataset.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 font-sans">
      {/* 1. Header Section */}
      <div className="flex items-center gap-3.5 bg-card border border-border p-4 rounded-sm shadow-xs">
        <div className="w-11 h-11 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
          <Globe className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">
            Geo & ASN Datasets
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Import custom CIDR, ISO country code, and ASN mapping datasets for geographic and autonomous system edge filtering.
          </p>
        </div>
      </div>

      {/* 2. Controls & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2.5">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search datasets by name, country, ASN, or CIDR..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-card border border-border pl-9 pr-8 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary rounded-sm transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Type Filter Dropdown */}
          <div className="relative w-40 shrink-0">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="w-full appearance-none bg-card border border-border text-foreground px-3 py-2 pr-8 text-xs rounded-sm focus:outline-none focus:border-primary transition-colors cursor-pointer font-medium"
            >
              <option value="all">All types</option>
              <option value="both">GeoIP + ASN</option>
              <option value="country">GeoIP Only</option>
              <option value="asn">ASN Only</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Add Dataset Button */}
        <button
          type="button"
          disabled={!status || busy}
          onClick={handleOpenCreate}
          className="flex items-center justify-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold rounded-sm shadow-xs transition-colors shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Add Dataset</span>
        </button>
      </div>

      {/* 3. Datasets List */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-card border border-border rounded-sm">
          <Globe className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-sm font-semibold text-foreground">
            {datasets.length === 0 ? "No custom datasets imported" : "No matching datasets"}
          </p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            {datasets.length === 0
              ? "Import external CIDR-to-Country or CIDR-to-ASN mappings for location and cloud provider access filtering."
              : "Try searching with different keywords or filter options."}
          </p>
          {datasets.length === 0 && (
            <button
              onClick={handleOpenCreate}
              disabled={!status || busy}
              className="mt-4 px-3.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-sm transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Import Dataset</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => {
            const doc = item.document as AccessDatasetDocument;
            const networks = doc.networks || [];
            const isCollapsed = collapsedPreviews[item.id] ?? false;
            const previewNetworks = networks.slice(0, 3);
            const hasCountry = networks.some((n) => Boolean(n.country));
            const hasAsn = networks.some((n) => Boolean(n.asn));

            return (
              <div
                key={item.id}
                className="bg-card border border-border rounded-lg p-5 space-y-4 shadow-xs hover:border-border/80 transition-colors"
              >
                {/* Card Top: Header & Details */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left: Icon, Name, Subtitle, Tags */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                      <Database className="w-5 h-5" />
                    </div>
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3
                          onClick={() => navigate(`/ip-access/datasets/${item.id}`)}
                          className="text-sm font-bold text-foreground cursor-pointer hover:text-primary transition-colors"
                        >
                          {doc.name}
                        </h3>
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          v{item.version}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Global GeoIP and ASN mappings from ISO 3166-1 catalog and routing directories.
                      </p>
                      <div className="flex items-center gap-2 pt-0.5">
                        {hasCountry && hasAsn ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            <Globe className="w-3 h-3" />
                            <span>GeoIP + ASN</span>
                          </span>
                        ) : hasCountry ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <Globe className="w-3 h-3" />
                            <span>GeoIP</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                            <Database className="w-3 h-3" />
                            <span>ASN</span>
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground border border-border">
                          Custom
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Stats, Last updated, Actions (NO STATUS) */}
                  <div className="flex items-center gap-6 self-start md:self-center shrink-0">
                    {/* Entries Count */}
                    <div className="text-right">
                      <div className="text-base font-bold text-foreground leading-none">
                        {networks.length}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Entries
                      </div>
                    </div>

                    {/* Last Updated */}
                    <div className="text-right min-w-[90px]">
                      <div className="text-xs font-semibold text-foreground leading-none">
                        {formatDatasetDate(item.updated_at)}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Last updated
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 border-l border-border pl-4">
                      <button
                        type="button"
                        onClick={() => navigate(`/ip-access/datasets/${item.id}`)}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors cursor-pointer"
                        title="View all entries"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectHistory(item)}
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors cursor-pointer"
                        title="Revisions & History"
                      >
                        <History className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={!status || busy}
                        onClick={() => setDeleteTarget(item)}
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors cursor-pointer disabled:opacity-50"
                        title="Delete dataset"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Card Bottom: Collapsible Dataset Preview Table */}
                <div className="pt-2 border-t border-border/60">
                  <div className="flex items-center justify-between pb-2">
                    <button
                      type="button"
                      onClick={() => togglePreview(item.id)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                    >
                      {isCollapsed ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                      <span>
                        Dataset Preview ({Math.min(previewNetworks.length, 3)} of {networks.length} entries)
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate(`/ip-access/datasets/${item.id}`)}
                      className="text-xs font-medium text-primary hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>View all {networks.length} entries</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div className="overflow-x-auto rounded border border-border">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted/40 text-muted-foreground text-[11px] font-medium border-b border-border">
                          <tr>
                            <th className="py-2 px-3 w-12 text-center">#</th>
                            <th className="py-2 px-3">CIDR / IP Range</th>
                            <th className="py-2 px-3 w-32">Country</th>
                            <th className="py-2 px-3 w-28">ASN</th>
                            <th className="py-2 px-3">Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60 font-sans">
                          {previewNetworks.map((net, i) => (
                            <tr key={i} className="hover:bg-muted/20 transition-colors">
                              <td className="py-2 px-3 text-center text-muted-foreground font-mono text-[11px]">
                                {i + 1}
                              </td>
                              <td className="py-2 px-3 font-mono text-foreground font-medium">
                                {net.cidr}
                              </td>
                              <td className="py-2 px-3">
                                {net.country ? (
                                  <div className="inline-flex items-center gap-1.5 text-foreground max-w-[200px]">
                                    <span className="text-sm leading-none shrink-0" title={getCountryFullName(net.country)}>
                                      {getCountryFlag(net.country)}
                                    </span>
                                    <span className="font-mono font-bold text-xs shrink-0">{net.country.toUpperCase()}</span>
                                    <span className="text-xs text-muted-foreground truncate" title={getCountryFullName(net.country)}>
                                      — {getCountryFullName(net.country)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground font-mono">-</span>
                                )}
                              </td>
                              <td className="py-2 px-3 font-mono text-foreground">
                                {net.asn ? net.asn.replace(/^AS/i, "") : "-"}
                              </td>
                              <td className="py-2 px-3 text-muted-foreground">
                                {getNetworkDescription(net)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Full Entries Modal */}
      {viewAllItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            {(() => {
              const doc = viewAllItem.document as AccessDatasetDocument;
              const allNetworks = doc.networks || [];
              const q = viewSearch.toLowerCase();
              const filteredList = allNetworks.filter(
                (n) =>
                  n.cidr.toLowerCase().includes(q) ||
                  n.country.toLowerCase().includes(q) ||
                  n.asn.toLowerCase().includes(q) ||
                  (COUNTRY_NAMES[n.country] && COUNTRY_NAMES[n.country].toLowerCase().includes(q)) ||
                  getNetworkDescription(n).toLowerCase().includes(q)
              );
              const pageSize = 25;
              const totalPages = Math.ceil(filteredList.length / pageSize) || 1;
              const currentPage = Math.min(viewPage, totalPages);
              const pagedList = filteredList.slice((currentPage - 1) * pageSize, currentPage * pageSize);

              return (
                <>
                  <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                        <Database className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-foreground">
                            {doc.name}
                          </h3>
                          <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            v{viewAllItem.version}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {allNetworks.length} total entries mapped
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleExportCsv(doc)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-card hover:bg-muted border border-border text-foreground text-xs font-medium rounded transition-colors cursor-pointer"
                        title="Download as CSV"
                      >
                        <Download className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>Export CSV</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewAllItem(null)}
                        className="p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Search bar inside modal */}
                  <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between gap-3">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Filter by CIDR, Country, ASN, or Description..."
                        value={viewSearch}
                        onChange={(e) => {
                          setViewSearch(e.target.value);
                          setViewPage(1);
                        }}
                        className="w-full bg-background border border-border pl-9 pr-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary rounded font-mono"
                      />
                      {viewSearch && (
                        <button
                          onClick={() => {
                            setViewSearch("");
                            setViewPage(1);
                          }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono shrink-0">
                      Showing {filteredList.length} of {allNetworks.length} entries
                    </div>
                  </div>

                  {/* Table */}
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="border border-border rounded overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted/40 text-muted-foreground text-[11px] font-medium border-b border-border">
                          <tr>
                            <th className="py-2.5 px-3 w-14 text-center">#</th>
                            <th className="py-2.5 px-3">CIDR / IP Range</th>
                            <th className="py-2.5 px-3 w-36">Country</th>
                            <th className="py-2.5 px-3 w-32">ASN</th>
                            <th className="py-2.5 px-3">Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {pagedList.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="text-center py-8 text-muted-foreground">
                                No matching records found
                              </td>
                            </tr>
                          ) : (
                            pagedList.map((net, i) => {
                              const globalIndex = (currentPage - 1) * pageSize + i + 1;
                              return (
                                <tr key={i} className="hover:bg-muted/20 transition-colors">
                                  <td className="py-2.5 px-3 text-center text-muted-foreground font-mono text-[11px]">
                                    {globalIndex}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono font-medium text-foreground">
                                    {net.cidr}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {net.country ? (
                                      <div className="inline-flex items-center gap-1.5 text-foreground max-w-[240px]">
                                        <span className="text-base leading-none shrink-0" title={getCountryFullName(net.country)}>
                                          {getCountryFlag(net.country)}
                                        </span>
                                        <span className="font-mono font-bold text-xs shrink-0">{net.country.toUpperCase()}</span>
                                        <span className="text-xs text-muted-foreground truncate" title={getCountryFullName(net.country)}>
                                          — {getCountryFullName(net.country)}
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground font-mono">-</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono text-foreground">
                                    {net.asn ? net.asn.replace(/^AS/i, "") : "-"}
                                  </td>
                                  <td className="py-2.5 px-3 text-muted-foreground">
                                    {getNetworkDescription(net)}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Pagination footer */}
                  <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-muted/10 text-xs">
                    <div className="text-muted-foreground">
                      Page {currentPage} of {totalPages}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={currentPage <= 1}
                        onClick={() => setViewPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1 bg-card hover:bg-muted disabled:opacity-40 border border-border rounded text-xs transition-colors cursor-pointer"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={currentPage >= totalPages}
                        onClick={() => setViewPage((p) => Math.min(totalPages, p + 1))}
                        className="px-3 py-1 bg-card hover:bg-muted disabled:opacity-40 border border-border rounded text-xs transition-colors cursor-pointer"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* 5. Add / Edit Dataset Modal */}
      {editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    {editor.id === 0 ? "Import Geo / ASN Dataset" : `Edit Dataset: ${editor.name}`}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {editor.id === 0
                      ? "Upload custom IP ranges mapped to ISO country codes and ASNs"
                      : `Updating version v${editor.version}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditor(null)}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2 rounded">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Dataset Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground flex justify-between">
                  <span>Dataset Name / Provenance</span>
                  <span className="text-[11px] font-normal text-muted-foreground">Max 120 chars</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  placeholder="e.g. Global ISO-3166 GeoIP & ASN Directory"
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  className="w-full bg-background border border-input text-foreground px-3 py-2 text-xs rounded focus:outline-none focus:border-primary transition-colors font-medium"
                />
              </div>

              {/* Format Hint Box */}
              <div className="p-3 bg-primary/5 border border-primary/20 rounded space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Expected CSV Format</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Each line must contain: <code className="px-1 py-0.5 bg-muted font-mono text-[10px] text-foreground rounded">CIDR, CountryCode, ASN</code>.
                </p>
                <div className="bg-background p-2 border border-border font-mono text-[10px] text-foreground rounded space-y-0.5">
                  <p>198.51.100.0/24, US, AS15169</p>
                  <p>14.160.0.0/11, VN, AS45899</p>
                </div>
              </div>

              {/* File Upload / Preload Shortcut */}
              <div className="flex items-center justify-between p-2.5 bg-muted/30 border border-dashed border-border rounded">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      Import CSV / text dataset file
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Maximum 64 KB dataset size
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLoadFullIsoDataset}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold rounded cursor-pointer transition-colors"
                    title="Populate editor with 249 ISO-3166 countries"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Preload 249 Countries</span>
                  </button>

                  <label className="flex items-center gap-1.5 px-2.5 py-1 bg-card hover:bg-muted border border-border text-xs font-medium text-foreground rounded cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>Browse CSV...</span>
                    <input
                      type="file"
                      accept=".csv,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Textarea */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground">
                    Dataset Mapping Rows
                  </label>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {editor.text.split("\n").filter((s) => s.trim()).length} rows
                  </span>
                </div>
                <textarea
                  required
                  rows={7}
                  placeholder={`1.1.1.0/24, US, AS13335\n8.8.8.0/24, US, AS15169`}
                  value={editor.text}
                  onChange={(e) => setEditor({ ...editor, text: e.target.value })}
                  className="w-full bg-background border border-input text-foreground p-3 text-xs font-mono rounded focus:outline-none focus:border-primary transition-colors leading-relaxed"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditor(null)}
                  className="px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold rounded shadow-xs transition-colors cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{busy ? "Saving..." : "Save Dataset"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Dataset Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2 text-destructive">
                <div className="w-8 h-8 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Delete Dataset?
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Confirm deletion of Geo & ASN dataset
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={deleteBusy || busy}
                onClick={() => setDeleteTarget(null)}
                className="text-muted-foreground hover:text-foreground p-1 cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-3 text-xs">
              <p className="text-muted-foreground leading-relaxed">
                Are you sure you want to delete dataset{" "}
                <strong className="font-semibold text-foreground px-1.5 py-0.5 rounded bg-muted/60 border border-border">
                  {(deleteTarget.document as AccessDatasetDocument)?.name || `Dataset #${deleteTarget.id}`}
                </strong>?
              </p>

              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-destructive text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Any active access rules referencing this dataset will lose their matching data across edge nodes. This action cannot be undone.
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-border bg-muted/20">
              <button
                type="button"
                disabled={deleteBusy || busy}
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-1.5 bg-card hover:bg-muted border border-border text-foreground text-xs font-medium rounded transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteBusy || busy}
                onClick={confirmDeleteDataset}
                className="px-4 py-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs font-semibold rounded transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deleteBusy ? "Deleting..." : "Yes, Delete Dataset"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
