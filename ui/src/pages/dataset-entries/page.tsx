import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  Globe,
  Database,
  ChevronLeft,
  Plus,
  Search,
  ChevronDown,
  Download,
  Pencil,
  Trash2,
  X,
  Check,
  AlertTriangle,
  Info,
  Lightbulb,
  ArrowUpDown,
  HelpCircle,
  ExternalLink,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  accessApi,
  type AccessObject,
  type AccessDatasetDocument,
  type AccessStatus,
} from "../../lib/api/access";

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
  "32934": "Meta Platforms",
  "16509": "Amazon Web Services",
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

function formatEntryDate(dateStr?: string): string {
  if (!dateStr) return "Recently";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "Recently";
    return d.toISOString().replace("T", " ").slice(0, 16);
  } catch {
    return "Recently";
  }
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

export default function DatasetEntriesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [item, setItem] = useState<AccessObject | null>(null);
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "both" | "country" | "asn">("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [asnFilter, setAsnFilter] = useState("all");

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modals
  const [entryModal, setEntryModal] = useState<{
    index: number; // -1 for new entry, >= 0 for editing
    cidr: string;
    country: string;
    asn: string;
  } | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<{
    index: number;
    cidr: string;
    country: string;
    asn: string;
  } | null>(null);

  const [formError, setFormError] = useState("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [objects, st] = await Promise.all([
        accessApi.list(),
        accessApi.status(),
      ]);
      setStatus(st);
      const found = objects.find((o) => String(o.id) === String(id) && o.kind === "dataset");
      if (found) {
        setItem(found);
      } else {
        setError("Dataset not found");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const doc = item?.document as AccessDatasetDocument | undefined;
  const rawNetworks = useMemo(() => doc?.networks || [], [doc]);

  // Available countries & ASNs for filter dropdowns
  const availableCountries = useMemo(() => {
    const set = new Set<string>();
    rawNetworks.forEach((n) => {
      if (n.country) set.add(n.country.toUpperCase());
    });
    return Array.from(set).sort();
  }, [rawNetworks]);

  const availableAsns = useMemo(() => {
    const set = new Set<string>();
    rawNetworks.forEach((n) => {
      if (n.asn) set.add(n.asn.replace(/^AS/i, ""));
    });
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [rawNetworks]);

  // Filtered networks
  const filteredNetworks = useMemo(() => {
    const rawQ = search.trim().toLowerCase();
    const normQ = normalizeSearchText(search);

    return rawNetworks.filter((n) => {
      // Type filter
      if (typeFilter === "both" && (!n.country || !n.asn)) return false;
      if (typeFilter === "country" && !n.country) return false;
      if (typeFilter === "asn" && !n.asn) return false;

      // Country filter
      if (countryFilter !== "all" && n.country?.toUpperCase() !== countryFilter) {
        return false;
      }

      // ASN filter
      if (asnFilter !== "all" && n.asn?.replace(/^AS/i, "") !== asnFilter) {
        return false;
      }

      // Search query
      if (!rawQ) return true;
      const cidrMatch = n.cidr.toLowerCase().includes(rawQ);
      const countryMatch = matchCountrySearch(n.country, search);
      const asnMatch =
        n.asn?.toLowerCase().includes(rawQ) ||
        n.asn?.replace(/^AS/i, "").includes(rawQ);
      const desc = getNetworkDescription(n);
      const descMatch =
        desc.toLowerCase().includes(rawQ) ||
        normalizeSearchText(desc).includes(normQ);

      return cidrMatch || countryMatch || asnMatch || descMatch;
    });
  }, [rawNetworks, search, typeFilter, countryFilter, asnFilter]);

  // Pagination calculations
  const totalEntries = filteredNetworks.length;
  const totalPages = Math.ceil(totalEntries / pageSize) || 1;
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedEntries = filteredNetworks.slice(startIndex, startIndex + pageSize);

  // Save new or edited entry
  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entryModal || !item || !status) return;
    setFormError("");

    try {
      const cidr = entryModal.cidr.trim();
      if (!cidr) {
        setFormError("CIDR / IP Range is required.");
        return;
      }
      const country = entryModal.country.trim().toUpperCase();
      const asn = entryModal.asn.trim().toUpperCase();

      const newNetworks = [...rawNetworks];
      const entryObj = { cidr, country, asn };

      if (entryModal.index >= 0) {
        // Edit existing
        newNetworks[entryModal.index] = entryObj;
      } else {
        // Add new
        newNetworks.unshift(entryObj);
      }

      setBusy(true);
      await accessApi.change(
        {
          id: item.id,
          kind: "dataset",
          expected_version: item.version,
          expected_release: status.release_id,
          delete: false,
          document: {
            name: doc?.name || "Global GeoIP & ASN Directory",
            networks: newNetworks,
          },
        },
        crypto.randomUUID()
      );

      setEntryModal(null);
      await fetchData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Delete entry confirmed via dialog
  const confirmDeleteEntry = async () => {
    if (!deleteTarget || !item || !status) return;

    try {
      setBusy(true);
      const newNetworks = rawNetworks.filter((_, i) => i !== deleteTarget.index);
      await accessApi.change(
        {
          id: item.id,
          kind: "dataset",
          expected_version: item.version,
          expected_release: status.release_id,
          delete: false,
          document: {
            name: doc?.name || "Global GeoIP & ASN Directory",
            networks: newNetworks,
          },
        },
        crypto.randomUUID()
      );
      setDeleteTarget(null);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Export CSV
  const handleExportCsv = () => {
    if (!doc) return;
    const lines = filteredNetworks.map((n) => `${n.cidr}, ${n.country}, ${n.asn}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-entries.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !item) {
    return (
      <div className="flex items-center justify-center p-16 text-muted-foreground text-xs">
        Loading dataset entries...
      </div>
    );
  }

  if (error || !item || !doc) {
    return (
      <div className="p-8 space-y-4 max-w-lg mx-auto text-center">
        <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
        <h2 className="text-base font-bold text-foreground">
          {error || "Dataset Not Found"}
        </h2>
        <p className="text-xs text-muted-foreground">
          The requested dataset could not be located or has been removed.
        </p>
        <Link
          to="/ip-access?tab=datasets"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Back to Datasets</span>
        </Link>
      </div>
    );
  }

  const hasCountry = rawNetworks.some((n) => Boolean(n.country));
  const hasAsn = rawNetworks.some((n) => Boolean(n.asn));

  return (
    <div className="p-6 w-full space-y-5 font-sans">
      {/* 1. Breadcrumbs */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link to="/ip-access" className="hover:text-foreground transition-colors">
          IP & Access Control
        </Link>
        <span>/</span>
        <Link to="/ip-access?tab=datasets" className="hover:text-foreground transition-colors">
          Geo / ASN Datasets
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">{doc.name}</span>
      </div>

      {/* 2. Top Header & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            Dataset Entries
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            View and manage all CIDR, country, and ASN mappings contained in this dataset.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            to="/ip-access?tab=datasets"
            className="flex items-center gap-1.5 px-3.5 py-2 bg-card hover:bg-muted border border-border text-foreground text-xs font-medium rounded shadow-xs transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Back to Datasets</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              setFormError("");
              setEntryModal({ index: -1, cidr: "", country: "", asn: "" });
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Entry</span>
          </button>
        </div>
      </div>

      {/* 3. Summary Card (NO STATUS - per user request) */}
      <div className="bg-card border border-border rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xs">
        {/* Left info */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <Globe className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-foreground">
                {doc.name}
              </h2>
              <span className="px-2 py-0.5 rounded text-xs font-mono bg-primary/10 text-primary border border-primary/20">
                v{item.version}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Import custom CIDR, ISO country code, and ASN mapping datasets.
            </p>
          </div>
        </div>

        {/* Right metrics (NO STATUS!) */}
        <div className="flex items-center gap-8 self-start md:self-center flex-wrap">
          {/* Total Entries */}
          <div>
            <div className="text-[11px] text-muted-foreground">Total Entries</div>
            <div className="text-base font-bold text-foreground mt-0.5">
              {rawNetworks.length}
            </div>
          </div>

          {/* Type */}
          <div>
            <div className="text-[11px] text-muted-foreground">Type</div>
            <div className="mt-0.5">
              {hasCountry && hasAsn ? (
                <span className="inline-block px-2.5 py-0.5 rounded text-xs font-medium bg-secondary/15 text-secondary border border-secondary/30">
                  GeoIP + ASN
                </span>
              ) : hasCountry ? (
                <span className="inline-block px-2.5 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                  GeoIP
                </span>
              ) : (
                <span className="inline-block px-2.5 py-0.5 rounded text-xs font-medium bg-muted text-foreground border border-border">
                  ASN
                </span>
              )}
            </div>
          </div>

          {/* Last Updated */}
          <div>
            <div className="text-[11px] text-muted-foreground">Last Updated</div>
            <div className="text-xs font-semibold text-foreground mt-0.5">
              {formatDatasetDate(item.updated_at)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              by {item.actor || "admin"}
            </div>
          </div>

          {/* Owner */}
          <div>
            <div className="text-[11px] text-muted-foreground">Owner</div>
            <div className="text-xs font-semibold text-foreground mt-0.5">
              {item.actor || "admin"}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Filter & Controls Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2.5 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search CIDR, country, ASN, description..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full bg-card border border-border pl-9 pr-8 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary rounded transition-colors"
            />
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Types Filter */}
          <div className="relative w-36 shrink-0">
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as any);
                setPage(1);
              }}
              className="w-full appearance-none bg-card border border-border text-foreground px-3 py-2 pr-8 text-xs rounded focus:outline-none focus:border-primary transition-colors cursor-pointer font-medium"
            >
              <option value="all">All Types</option>
              <option value="both">GeoIP + ASN</option>
              <option value="country">GeoIP Only</option>
              <option value="asn">ASN Only</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Countries Filter */}
          <div className="relative min-w-36 max-w-xs shrink-0">
            <select
              value={countryFilter}
              onChange={(e) => {
                setCountryFilter(e.target.value);
                setPage(1);
              }}
              className="w-full appearance-none bg-card border border-border text-foreground px-3 py-2 pr-8 text-xs rounded focus:outline-none focus:border-primary transition-colors cursor-pointer font-medium truncate"
            >
              <option value="all">All Countries</option>
              {availableCountries.map((c) => (
                <option key={c} value={c}>
                  {c} — {getCountryFullName(c)}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* ASNs Filter */}
          <div className="relative w-36 shrink-0">
            <select
              value={asnFilter}
              onChange={(e) => {
                setAsnFilter(e.target.value);
                setPage(1);
              }}
              className="w-full appearance-none bg-card border border-border text-foreground px-3 py-2 pr-8 text-xs rounded focus:outline-none focus:border-primary transition-colors cursor-pointer font-medium"
            >
              <option value="all">All ASNs</option>
              {availableAsns.map((a) => (
                <option key={a} value={a}>
                  AS{a}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* Export CSV Button */}
        <button
          type="button"
          onClick={handleExportCsv}
          className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-card hover:bg-muted border border-border text-foreground text-xs font-medium rounded shadow-xs transition-colors shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* 5. Table Container */}
      <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-xs font-bold text-foreground">
            All Entries ({filteredNetworks.length})
          </h3>
          <span className="text-[11px] text-muted-foreground font-mono">
            {totalEntries} total matching
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground text-[11px] font-medium border-b border-border">
              <tr>
                <th className="py-2.5 px-3 w-12 text-center">#</th>
                <th className="py-2.5 px-4 w-48 whitespace-nowrap">CIDR / IP Range</th>
                <th className="py-2.5 px-4 w-64 whitespace-nowrap">Country</th>
                <th className="py-2.5 px-4 w-24 whitespace-nowrap">ASN</th>
                <th className="py-2.5 px-4">Description</th>
                <th className="py-2.5 px-4 w-28 text-center whitespace-nowrap">Source</th>
                {/* NO STATUS COLUMN - per user instruction! */}
                <th className="py-2.5 px-4 w-36 whitespace-nowrap">Last Updated</th>
                <th className="py-2.5 px-4 w-20 text-right pr-4 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {paginatedEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted-foreground">
                    No matching entries found in this dataset.
                  </td>
                </tr>
              ) : (
                paginatedEntries.map((net, i) => {
                  const actualIndex = startIndex + i;
                  return (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 px-3 text-center text-muted-foreground font-mono text-[11px]">
                        {actualIndex + 1}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-medium text-foreground whitespace-nowrap">
                        {net.cidr}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {net.country ? (
                          <div className="inline-flex items-center gap-1.5 text-foreground">
                            <span className="text-base leading-none shrink-0" title={getCountryFullName(net.country)}>
                              {getCountryFlag(net.country)}
                            </span>
                            <span className="font-mono font-bold text-xs shrink-0">{net.country.toUpperCase()}</span>
                            <span className="text-xs text-muted-foreground" title={getCountryFullName(net.country)}>
                              — {getCountryFullName(net.country)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground font-mono">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-foreground whitespace-nowrap">
                        {net.asn ? net.asn.replace(/^AS/i, "") : "-"}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground">
                        {getNetworkDescription(net)}
                      </td>
                      <td className="py-2.5 px-4 text-center whitespace-nowrap">
                        {net.country && net.asn ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-secondary/15 text-secondary border border-secondary/30">
                            GeoIP + ASN
                          </span>
                        ) : net.country ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                            GeoIP Only
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                            ASN List
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground font-mono text-[11px] whitespace-nowrap">
                        {formatEntryDate(item.updated_at)}
                      </td>
                      <td className="py-2.5 px-4 text-right pr-4 whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setFormError("");
                              setEntryModal({ index: actualIndex, ...net });
                            }}
                            className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
                            title="Edit entry"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget({ index: actualIndex, ...net })}
                            className="p-1 text-muted-foreground hover:text-destructive rounded transition-colors cursor-pointer"
                            title="Delete entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/10 text-xs">
          <div className="text-muted-foreground font-mono">
            Showing {Math.min(startIndex + 1, totalEntries)}-{Math.min(startIndex + pageSize, totalEntries)} of {totalEntries} entries
          </div>

          <div className="flex items-center gap-4">
            {/* Page number buttons */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 bg-card hover:bg-muted disabled:opacity-40 border border-border rounded text-xs transition-colors cursor-pointer"
              >
                &lt;
              </button>

              {Array.from({ length: Math.min(totalPages, 5) }).map((_, idx) => {
                let pNum = idx + 1;
                if (totalPages > 5 && currentPage > 3) {
                  pNum = currentPage - 3 + idx;
                  if (pNum > totalPages) pNum = totalPages - (4 - idx);
                }
                return (
                  <button
                    key={pNum}
                    type="button"
                    onClick={() => setPage(pNum)}
                    className={`px-2.5 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                      currentPage === pNum
                        ? "bg-primary text-primary-foreground font-bold"
                        : "bg-card hover:bg-muted border border-border text-foreground"
                    }`}
                  >
                    {pNum}
                  </button>
                );
              })}

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 bg-card hover:bg-muted disabled:opacity-40 border border-border rounded text-xs transition-colors cursor-pointer"
              >
                &gt;
              </button>
            </div>

            {/* Page size dropdown */}
            <div className="relative">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="appearance-none bg-card border border-border text-foreground px-2.5 py-1 pr-6 text-xs rounded focus:outline-none focus:border-primary cursor-pointer font-mono"
              >
                <option value={10}>10 / page</option>
                <option value={25}>25 / page</option>
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
              </select>
              <ChevronDown className="w-3 h-3 text-muted-foreground absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* 6. Bottom Information Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
        {/* About Dataset Entries */}
        <div className="flex items-start gap-3 bg-card border border-border p-4 rounded-lg shadow-xs">
          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
            <Info className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-foreground">
              About Dataset Entries
            </h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              These entries provide reference mappings for geographic location and autonomous system matching in IP Access rules. Changes are applied when the dataset is updated.
            </p>
          </div>
        </div>

        {/* Tip */}
        <div className="flex items-start gap-3 bg-card border border-border p-4 rounded-lg shadow-xs">
          <div className="w-8 h-8 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
            <Lightbulb className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-foreground">
              Tip
            </h4>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Keep your dataset entries up to date to ensure accurate geolocation, ASN mapping, and access control decisions at the edge.
            </p>
          </div>
        </div>
      </div>

      {/* 7. Add / Edit Entry Modal */}
      {entryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-bold text-foreground">
                {entryModal.index >= 0 ? "Edit Dataset Entry" : "Add Dataset Entry"}
              </h3>
              <button
                type="button"
                onClick={() => setEntryModal(null)}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <TooltipProvider delayDuration={150}>
              <form onSubmit={handleSaveEntry} className="p-5 space-y-4">
                {formError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2 rounded">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* CIDR */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs font-semibold text-foreground">
                        CIDR / IP Range *
                      </label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center p-0.5 rounded-full hover:bg-muted/50 transition-colors"
                            aria-label="CIDR format help"
                          >
                            <HelpCircle className="w-3.5 h-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-xs bg-popover text-popover-foreground border border-border p-3 shadow-md rounded-md text-xs space-y-1.5">
                          <div className="font-semibold text-foreground">Định dạng CIDR / IP Range</div>
                          <div className="text-muted-foreground leading-relaxed">
                            Nhập địa chỉ IP đơn lẻ kèm prefix hoặc một subnet/dải mạng (IPv4 hoặc IPv6).
                          </div>
                          <div className="bg-muted/50 rounded p-1.5 font-mono text-[11px] space-y-0.5 border border-border">
                            <div>• IP đơn lẻ: 1.1.1.1/32</div>
                            <div>• Dải IP subnet: 14.160.0.0/11</div>
                            <div>• IPv6 subnet: 2405:4800::/32</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <a
                      href="https://cidr.xyz"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <span>Tra cứu / Tính CIDR</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 14.160.0.0/11 or 8.8.8.0/24"
                    value={entryModal.cidr}
                    onChange={(e) => setEntryModal({ ...entryModal, cidr: e.target.value })}
                    className="w-full bg-background border border-input text-foreground px-3 py-2 text-xs rounded focus:outline-none focus:border-primary font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Ví dụ: 192.168.1.0/24 (dải IP) hoặc 1.1.1.1/32 (IP đơn lẻ).
                  </p>
                </div>

                {/* Country */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs font-semibold text-foreground">
                        Country Code (ISO 3166-1 alpha-2)
                      </label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center p-0.5 rounded-full hover:bg-muted/50 transition-colors"
                            aria-label="Country code help"
                          >
                            <HelpCircle className="w-3.5 h-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-xs bg-popover text-popover-foreground border border-border p-3 shadow-md rounded-md text-xs space-y-1.5">
                          <div className="font-semibold text-foreground">Mã quốc gia ISO 3166-1 alpha-2</div>
                          <div className="text-muted-foreground leading-relaxed">
                            Chuẩn quốc tế gồm 2 chữ cái viết hoa đại diện cho quốc gia hoặc vùng lãnh thổ.
                          </div>
                          <div className="bg-muted/50 rounded p-1.5 font-mono text-[11px] space-y-0.5 border border-border">
                            <div>• VN: Việt Nam</div>
                            <div>• US: Hoa Kỳ</div>
                            <div>• SG: Singapore | JP: Nhật Bản</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <a
                      href="https://www.iban.com/country-codes"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <span>Tra cứu mã ISO 3166-1</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <input
                    type="text"
                    maxLength={2}
                    placeholder="e.g. VN, US, JP, SG"
                    value={entryModal.country}
                    onChange={(e) => setEntryModal({ ...entryModal, country: e.target.value.toUpperCase() })}
                    className="w-full bg-background border border-input text-foreground px-3 py-2 text-xs rounded focus:outline-none focus:border-primary font-mono uppercase"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Chuỗi đúng 2 ký tự (ví dụ: VN cho Việt Nam, US cho Hoa Kỳ).
                  </p>
                </div>

                {/* ASN */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs font-semibold text-foreground">
                        Autonomous System Number (ASN)
                      </label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center p-0.5 rounded-full hover:bg-muted/50 transition-colors"
                            aria-label="ASN format help"
                          >
                            <HelpCircle className="w-3.5 h-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-xs bg-popover text-popover-foreground border border-border p-3 shadow-md rounded-md text-xs space-y-1.5">
                          <div className="font-semibold text-foreground">Autonomous System Number (ASN)</div>
                          <div className="text-muted-foreground leading-relaxed">
                            Mã định danh hệ thống mạng tự trị của ISP/nhà mạng hoặc doanh nghiệp (hỗ trợ nhập số hoặc có tiền tố AS).
                          </div>
                          <div className="bg-muted/50 rounded p-1.5 font-mono text-[11px] space-y-0.5 border border-border">
                            <div>• AS45899 (hoặc 45899): VNPT</div>
                            <div>• AS7552 (hoặc 7552): Viettel</div>
                            <div>• AS13335 (hoặc 13335): Cloudflare</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <a
                      href="https://bgp.tools"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                    >
                      <span>Tra cứu ASN (bgp.tools)</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. AS45899 or 13335"
                    value={entryModal.asn}
                    onChange={(e) => setEntryModal({ ...entryModal, asn: e.target.value })}
                    className="w-full bg-background border border-input text-foreground px-3 py-2 text-xs rounded focus:outline-none focus:border-primary font-mono"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Định dạng số nguyên hoặc kèm tiền tố "AS" (ví dụ: AS45899 hoặc 45899).
                  </p>
                </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEntryModal(null)}
                  className="px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-semibold rounded shadow-xs transition-colors"
                >
                  {busy ? "Saving..." : "Save Entry"}
                </button>
              </div>
            </form>
          </TooltipProvider>
          </div>
        </div>
      )}

      {/* 8. Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-destructive/5">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-sm bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    Are you sure?
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Delete CIDR mapping from dataset
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
                className="text-muted-foreground hover:text-foreground p-1 cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-3 text-xs">
              <p className="text-muted-foreground leading-relaxed">
                Are you sure you want to remove the CIDR mapping for{" "}
                <strong className="font-mono text-foreground font-semibold px-1.5 py-0.5 rounded bg-muted/60 border border-border">
                  {deleteTarget.cidr}
                </strong>
                {deleteTarget.country ? ` (${deleteTarget.country.toUpperCase()} — ${getCountryFullName(deleteTarget.country)})` : ""}?
              </p>

              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-destructive text-[11px] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  This action cannot be undone. Any active access rules relying on this CIDR or country/ASN mapping may be immediately affected.
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-border bg-muted/20">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-1.5 bg-card hover:bg-muted border border-border text-foreground text-xs font-medium rounded transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirmDeleteEntry}
                className="px-4 py-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs font-semibold rounded transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5 shadow-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{busy ? "Deleting..." : "Yes, Delete Entry"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
