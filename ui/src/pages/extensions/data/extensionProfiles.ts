// Per-Extension Named Profile definitions & resolution helpers.
// Each extension owns a set of named profiles (built-in defaults + custom `config.profiles`),
// and each Route selects at most 1 profile per extension (or Off / Disabled).

export interface ExtensionProfileOption {
  id: string;
  label: string;
  summary: string;
  builtin?: boolean;
  params: Record<string, any>;
}

export interface ProfileFieldSchema {
  key: string;
  label: string;
  type: 'number' | 'text' | 'select';
  defaultValue: any;
  options?: { label: string; value: string }[];
  placeholder?: string;
}

export interface DataplaneExtensionMeta {
  key: string;
  label: string;
  shortLabel: string;
  category: 'performance' | 'security' | 'traffic';
  description: string;
  defaultProfiles: ExtensionProfileOption[];
  profileFields: ProfileFieldSchema[];
}

export const DATAPLANE_EXTENSION_CATALOG: DataplaneExtensionMeta[] = [
  {
    key: 'response-cache',
    label: 'Response Cache (Zero-Copy SHM)',
    shortLabel: 'Cache',
    category: 'performance',
    description: 'Lưu cache RAM đa biến thể (Identity, Zstd, Brotli, Gzip)',
    defaultProfiles: [
      {
        id: 'standard',
        label: 'Standard Cache (300s)',
        summary: 'TTL 300s — Cân bằng tốc độ và độ mới dữ liệu',
        builtin: true,
        params: { ttl_secs: 300 },
      },
      {
        id: 'short_ttl',
        label: 'Micro-Cache (30s)',
        summary: 'TTL 30s — Chống đột biến tải cho API thay đổi thường xuyên',
        builtin: true,
        params: { ttl_secs: 30 },
      },
      {
        id: 'medium_ttl',
        label: 'Medium Cache (120s)',
        summary: 'TTL 120s — Phù hợp danh mục sản phẩm / feed công khai',
        builtin: true,
        params: { ttl_secs: 120 },
      },
      {
        id: 'long_static',
        label: 'Immutable / Static (3600s)',
        summary: 'TTL 3600s (1 giờ) — Tài nguyên tĩnh hoặc dữ liệu ít biến동',
        builtin: true,
        params: { ttl_secs: 3600 },
      },
    ],
    profileFields: [
      {
        key: 'ttl_secs',
        label: 'TTL (Seconds)',
        type: 'number',
        defaultValue: 300,
      },
    ],
  },
  {
    key: 'response-compression',
    label: 'Response Compression (Zstd / Br / Gzip)',
    shortLabel: 'Compress',
    category: 'performance',
    description: 'Đàm phán Accept-Encoding và nén phản hồi tự động',
    defaultProfiles: [
      {
        id: 'balanced',
        label: 'Balanced (Zstd -> Br -> Gzip, >= 1KB)',
        summary: 'Min 1024B — Ưu tiên Zstd/Brotli cân bằng CPU & băng thông',
        builtin: true,
        params: { min_length: 1024, prefer_algorithms: ['zstd', 'br', 'gzip'] },
      },
      {
        id: 'fast_zstd',
        label: 'Fast Zstd Priority (>= 256B)',
        summary: 'Min 256B — Nén siêu tốc độ trễ thấp với Zstd & Gzip',
        builtin: true,
        params: { min_length: 256, prefer_algorithms: ['zstd', 'gzip'] },
      },
      {
        id: 'max_ratio',
        label: 'Max Compression Ratio (>= 512B)',
        summary: 'Min 512B — Ưu tiên Brotli tiết kiệm tối đa băng thông',
        builtin: true,
        params: { min_length: 512, prefer_algorithms: ['br', 'zstd', 'gzip'] },
      },
      {
        id: 'large_payloads',
        label: 'Large Payloads Only (>= 4KB)',
        summary: 'Min 4096B — Chỉ nén các phản hồi JSON/HTML lớn',
        builtin: true,
        params: { min_length: 4096, prefer_algorithms: ['zstd', 'br', 'gzip'] },
      },
    ],
    profileFields: [
      {
        key: 'min_length',
        label: 'Min Payload Size (Bytes)',
        type: 'number',
        defaultValue: 1024,
      },
    ],
  },
  {
    key: 'rate-limit',
    label: 'Rate Limiting (Token / Sliding Window)',
    shortLabel: 'RateLimit',
    category: 'traffic',
    description: 'Giới hạn tần suất request chống DDoS / lạm dụng API',
    defaultProfiles: [
      {
        id: 'standard',
        label: 'Standard API (100 req/s, burst 200)',
        summary: '100 req/s mỗi IP (Burst 200) — Mặc định cho REST API',
        builtin: true,
        params: {
          rate: 100,
          period_secs: 1,
          burst: 200,
          limit_by: 'client_ip',
          action_on_exceeded: 'throttle',
        },
      },
      {
        id: 'strict',
        label: 'Strict Auth/Write (10 req/s, burst 20)',
        summary: '10 req/s mỗi IP (Burst 20) — Bảo vệ Login / Checkout / Mutation',
        builtin: true,
        params: {
          rate: 10,
          period_secs: 1,
          burst: 20,
          limit_by: 'client_ip',
          action_on_exceeded: 'throttle',
        },
      },
      {
        id: 'high_throughput',
        label: 'High Throughput (1000 req/s, burst 2000)',
        summary: '1000 req/s mỗi IP — Dành cho luồng dữ liệu tần suất cao',
        builtin: true,
        params: {
          rate: 1000,
          period_secs: 1,
          burst: 2000,
          limit_by: 'client_ip',
          action_on_exceeded: 'throttle',
        },
      },
      {
        id: 'burst_tolerant',
        label: 'Burst Tolerant (250 req/s, burst 1000)',
        summary: '250 req/s (Burst 1000) — Cho phép tải trang SPA nhiều request song song',
        builtin: true,
        params: {
          rate: 250,
          period_secs: 1,
          burst: 1000,
          limit_by: 'client_ip',
          action_on_exceeded: 'throttle',
        },
      },
    ],
    profileFields: [
      {
        key: 'rate',
        label: 'Rate (Requests / Period)',
        type: 'number',
        defaultValue: 100,
      },
      {
        key: 'period_secs',
        label: 'Period (Seconds)',
        type: 'number',
        defaultValue: 1,
      },
      {
        key: 'burst',
        label: 'Burst Capacity',
        type: 'number',
        defaultValue: 200,
      },
      {
        key: 'action_on_exceeded',
        label: 'Action on Exceeded',
        type: 'select',
        defaultValue: 'throttle',
        options: [
          { label: 'Throttle (429)', value: 'throttle' },
          { label: 'Block (403)', value: 'block' },
          { label: 'Audit Only', value: 'audit' },
        ],
      },
    ],
  },
  {
    key: 'jwt-authentication',
    label: 'JWT Authentication (RS256 / JWKS)',
    shortLabel: 'JWT',
    category: 'security',
    description: 'Xác thực chữ ký Bearer Token tại biên FFI',
    defaultProfiles: [
      {
        id: 'default',
        label: 'Default JWT Policy',
        summary: 'Xác thực Bearer JWT theo cấu hình Origin/Public Key mặc định',
        builtin: true,
        params: {},
      },
      {
        id: 'strict',
        label: 'Strict Token Verification',
        summary: 'Bắt buộc xác thực đầy đủ thời hạn và chữ ký RS256',
        builtin: true,
        params: { strict: true },
      },
    ],
    profileFields: [
      {
        key: 'header_name',
        label: 'Token Header Name',
        type: 'text',
        defaultValue: 'Authorization',
      },
    ],
  },
  {
    key: 'ip-restriction',
    label: 'IP Restriction (CIDR ACL)',
    shortLabel: 'IP-ACL',
    category: 'security',
    description: 'Kiểm soát danh sách IP Whitelist / Blacklist bằng Radix Trie',
    defaultProfiles: [
      {
        id: 'default',
        label: 'Default IP ACL Policy',
        summary: 'Áp dụng danh sách Whitelist / Blacklist chung của Extension',
        builtin: true,
        params: {},
      },
      {
        id: 'internal_only',
        label: 'Internal / Private Networks Only',
        summary: 'Chỉ cho phép mạng nội bộ RFC1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)',
        builtin: true,
        params: {
          action: 'allow',
          networks: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.1/32'],
        },
      },
    ],
    profileFields: [
      {
        key: 'action',
        label: 'Action',
        type: 'select',
        defaultValue: 'allow',
        options: [
          { label: 'Allow Networks', value: 'allow' },
          { label: 'Deny Networks', value: 'deny' },
        ],
      },
    ],
  },
  {
    key: 'connection-limit',
    label: 'Connection Limit (Concurrent Guard)',
    shortLabel: 'ConnLimit',
    category: 'traffic',
    description: 'Giới hạn số kết nối đồng thời trên mỗi Client IP',
    defaultProfiles: [
      {
        id: 'standard',
        label: 'Standard (100 Max Connections / IP)',
        summary: 'Tối đa 100 kết nối đồng thời mỗi IP',
        builtin: true,
        params: { max_connections: 100, limit_by: 'client_ip', action_on_exceeded: 'throttle' },
      },
      {
        id: 'strict',
        label: 'Strict (20 Max Connections / IP)',
        summary: 'Tối đa 20 kết nối đồng thời mỗi IP — Chống giữ kết nối Slowloris',
        builtin: true,
        params: { max_connections: 20, limit_by: 'client_ip', action_on_exceeded: 'throttle' },
      },
      {
        id: 'high_concurrency',
        label: 'High Concurrency (500 Max Connections / IP)',
        summary: 'Tối đa 500 kết nối đồng thời mỗi IP — Dành cho B2B / NAT Gateway',
        builtin: true,
        params: { max_connections: 500, limit_by: 'client_ip', action_on_exceeded: 'throttle' },
      },
    ],
    profileFields: [
      {
        key: 'max_connections',
        label: 'Max Concurrent Connections',
        type: 'number',
        defaultValue: 100,
      },
    ],
  },
  {
    key: 'resource-limit',
    label: 'Resource Limit (Payload & Overload Guard)',
    shortLabel: 'ResLimit',
    category: 'security',
    description: 'Bảo vệ kích thước body, header và chống quá tải tài nguyên',
    defaultProfiles: [
      {
        id: 'standard',
        label: 'Standard Resource Protection',
        summary: 'Giới hạn kích thước Payload và Header tiêu chuẩn',
        builtin: true,
        params: {},
      },
      {
        id: 'strict',
        label: 'Strict Small Payload Guard',
        summary: 'Giới hạn chặt kích thước Request cho các API JSON nhỏ',
        builtin: true,
        params: { strict: true },
      },
    ],
    profileFields: [],
  },
  {
    key: 'traffic-shaper',
    label: 'Traffic Shaper (QoS Bandwidth)',
    shortLabel: 'Shaper',
    category: 'traffic',
    description: 'Điều tiết băng thông và độ ưu tiên luồng dữ liệu',
    defaultProfiles: [
      {
        id: 'standard',
        label: 'Standard QoS Shaping',
        summary: 'Điều tiết luồng dữ liệu theo cấu hình QoS mặc định',
        builtin: true,
        params: {},
      },
      {
        id: 'priority',
        label: 'High Priority Fast-Lane',
        summary: 'Ưu tiên băng thông cho luồng API quan trọng',
        builtin: true,
        params: { priority: 'high' },
      },
    ],
    profileFields: [],
  },
];

export function normalizeExtensionKey(rawKey: string): string {
  const clean = rawKey.trim().replace(/^builtin\//, '');
  if (clean === 'engine-jwt-rs256' || clean === 'jwt') return 'jwt-authentication';
  if (clean === 'compression-gzip') return 'response-compression';
  return clean;
}

export function findDataplaneExtensionMeta(rawKey: string): DataplaneExtensionMeta | undefined {
  const clean = normalizeExtensionKey(rawKey);
  return DATAPLANE_EXTENSION_CATALOG.find((item) => item.key === clean);
}

/**
 * Merges built-in default profiles for an extension with custom named profiles
 * stored in `config.profiles` of that extension instance.
 */
export function resolveExtensionProfiles(
  rawKey: string,
  configJsonOrObj?: string | Record<string, any>
): ExtensionProfileOption[] {
  const meta = findDataplaneExtensionMeta(rawKey);
  const builtins: ExtensionProfileOption[] = meta
    ? [...meta.defaultProfiles]
    : [
        {
          id: 'default',
          label: 'Default Profile',
          summary: 'Sử dụng cấu hình mặc định của Extension',
          builtin: true,
          params: {},
        },
      ];

  let parsed: Record<string, any> | null = null;
  if (typeof configJsonOrObj === 'string' && configJsonOrObj.trim()) {
    try {
      parsed = JSON.parse(configJsonOrObj);
    } catch {
      parsed = null;
    }
  } else if (configJsonOrObj && typeof configJsonOrObj === 'object') {
    parsed = configJsonOrObj;
  }

  if (!parsed || !parsed.profiles || typeof parsed.profiles !== 'object') {
    return builtins;
  }

  const merged = [...builtins];
  for (const [profId, profVal] of Object.entries(parsed.profiles)) {
    if (!profId.trim() || !profVal || typeof profVal !== 'object') continue;
    const valObj = profVal as Record<string, any>;
    const customLabel =
      typeof valObj.label === 'string' && valObj.label.trim()
        ? valObj.label.trim()
        : `${profId} (Custom)`;

    // Build a concise summary from parameters
    const summaryParts: string[] = [];
    if (valObj.ttl_secs !== undefined) summaryParts.push(`TTL ${valObj.ttl_secs}s`);
    if (valObj.rate !== undefined)
      summaryParts.push(`${valObj.rate} req/${valObj.period_secs ?? 1}s`);
    if (valObj.burst !== undefined) summaryParts.push(`burst ${valObj.burst}`);
    if (valObj.min_length !== undefined) summaryParts.push(`min ${valObj.min_length}B`);
    if (valObj.max_connections !== undefined)
      summaryParts.push(`max ${valObj.max_connections} conn`);
    if (valObj.summary && typeof valObj.summary === 'string') {
      summaryParts.unshift(valObj.summary);
    }

    const option: ExtensionProfileOption = {
      id: profId,
      label: customLabel,
      summary: summaryParts.length > 0 ? summaryParts.join(' · ') : 'Custom Extension Profile',
      builtin: false,
      params: valObj,
    };

    const existingIdx = merged.findIndex((p) => p.id === profId);
    if (existingIdx >= 0) {
      merged[existingIdx] = option;
    } else {
      merged.push(option);
    }
  }

  return merged;
}
