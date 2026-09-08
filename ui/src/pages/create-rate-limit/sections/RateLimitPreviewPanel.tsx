import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type {
  DimensionType,
  IpConfig,
  HeaderMatchConfig,
  PathScopeConfig,
} from './RateLimitConfigSection';

interface RateLimitPreviewProps {
  name: string;
  enabledDimensions: DimensionType[];
  dimensionOrder: DimensionType[];
  ipConfig: IpConfig;
  headerConfig: HeaderMatchConfig;
  pathConfig: PathScopeConfig;
  rateLimit: number;
  rateUnit: string;
  burst: number;
  actionExceeded: string;
  customResponse: boolean;
  responseCode: string;
  responseBody: string;
}

export function RateLimitPreviewPanel(props: RateLimitPreviewProps) {
  const [tab, setTab] = useState<'nginx' | 'lua' | 'json'>('nginx');
  const [copied, setCopied] = useState(false);

  // Derive variable key based on active dimensions in configured evaluation order
  const keysList: string[] = [];
  props.dimensionOrder.forEach((dim) => {
    if (dim === 'ip') keysList.push(`$${props.ipConfig.source || 'binary_remote_addr'}`);
    if (dim === 'header') {
      const hName = props.headerConfig.headerName ? props.headerConfig.headerName.toLowerCase().replace(/-/g, '_') : 'custom_header';
      keysList.push(`$http_${hName}`);
    }
    if (dim === 'path') keysList.push('$uri');
  });

  const keyVar = keysList.length > 0 ? keysList.join('~') : '$binary_remote_addr';

  // Zone rate string
  let rateSuffix = 'r/m';
  if (props.rateUnit === '1 second') rateSuffix = 'r/s';
  if (props.rateUnit === '1 hour') rateSuffix = 'r/h';

  const zoneName = `limit_${props.name ? props.name.replace(/[^a-zA-Z0-9_]/g, '_') : 'zone'}`;
  const targetPath = props.enabledDimensions.includes('path') ? (props.pathConfig.path || '/') : '/';

  const nginxContent = `# Rate limit: ${props.name || 'unnamed-limit'}
# Evaluated dimensions: ${props.dimensionOrder.join(' -> ')}
limit_req_zone ${keyVar} zone=${zoneName}:10m
               rate=${props.rateLimit}${rateSuffix};

server {
    location ${targetPath} {
        limit_req zone=${zoneName}${props.burst > 0 ? ` burst=${props.burst}` : ''} nodelay;
        limit_req_status ${props.responseCode || '429'};

        ${props.customResponse ? `add_header Content-Type "application/json";
        return ${props.responseCode || '429'} '${props.responseBody.replace(/\n\s*/g, '')}';` : '# default rate limit behavior'}
    }
}`;

  const luaContent = `-- Generated OpenResty Lua evaluation handler for ${props.name || 'rate_limit'}
local limit_req = require "resty.limit.req"
local lim, err = limit_req.new("${zoneName}", ${props.rateLimit}, ${props.burst})
if not lim then
    ngx.log(ngx.ERR, "failed to instantiate resty.limit.req: ", err)
    return ngx.exit(500)
end

-- Compound key evaluation (Order: ${props.dimensionOrder.join(' -> ')})
local keys = {}
${props.dimensionOrder.map((d) => {
  if (d === 'ip') return 'table.insert(keys, ngx.var.binary_remote_addr)';
  if (d === 'header') return `table.insert(keys, ngx.req.get_headers()["${(props.headerConfig.headerName || 'x-api-key').toLowerCase()}"] or "-")`;
  if (d === 'path') return 'table.insert(keys, ngx.var.uri)';
  return '';
}).filter(Boolean).join('\n')}
local key = table.concat(keys, "~")

local delay, err = lim:incoming(key, true)
if not delay then
    if err == "rejected" then
        ngx.status = ${props.responseCode || 429}
        ngx.header.content_type = "application/json"
        ngx.say('${props.responseBody.replace(/\n\s*/g, '')}')
        return ngx.exit(ngx.status)
    end
    return ngx.exit(500)
end`;

  const jsonContent = JSON.stringify(
    {
      name: props.name || 'unnamed-rate-limit',
      dimensions: {
        enabled: props.enabledDimensions,
        evaluation_order: props.dimensionOrder,
        ip: props.enabledDimensions.includes('ip') ? props.ipConfig : undefined,
        header: props.enabledDimensions.includes('header') ? props.headerConfig : undefined,
        path: props.enabledDimensions.includes('path') ? props.pathConfig : undefined,
      },
      rate: {
        limit: props.rateLimit,
        unit: props.rateUnit,
        burst: props.burst,
      },
      action: props.actionExceeded,
      custom_response: props.customResponse
        ? {
            code: parseInt(props.responseCode) || 429,
            body: props.responseBody,
          }
        : null,
    },
    null,
    2
  );

  const currentContent = tab === 'nginx' ? nginxContent : tab === 'lua' ? luaContent : jsonContent;
  const lines = currentContent.split('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-card border border-border p-4 space-y-3 font-sans text-xs">
      <div className="text-sm font-semibold text-foreground">Rule Preview</div>

      {/* Preview Tabs */}
      <div className="flex items-center justify-between border-b border-border bg-muted/30">
        <div className="flex overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('nginx')}
            className={`px-3 py-1.5 text-xs transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'nginx'
                ? 'text-primary border-b-2 border-primary font-semibold bg-card'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            NGINX Config
          </button>
          <button
            type="button"
            onClick={() => setTab('lua')}
            className={`px-3 py-1.5 text-xs transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'lua'
                ? 'text-primary border-b-2 border-primary font-semibold bg-card'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Lua Script (Generated)
          </button>
          <button
            type="button"
            onClick={() => setTab('json')}
            className={`px-3 py-1.5 text-xs transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'json'
                ? 'text-primary border-b-2 border-primary font-semibold bg-card'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            JSON
          </button>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2.5 py-1 bg-card hover:bg-muted border border-border text-muted-foreground hover:text-foreground text-[11px] cursor-pointer transition-colors m-1"
        >
          {copied ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Code Window with line numbers */}
      <div className="bg-background border border-border p-3 text-xs font-mono overflow-x-auto">
        <div className="space-y-0.5">
          {lines.map((line, idx) => (
            <div key={idx} className="flex leading-5">
              <span className="w-6 text-muted-foreground/50 select-none text-right pr-3 shrink-0">
                {idx + 1}
              </span>
              <span className="text-foreground whitespace-pre">
                {line.startsWith('#') || line.startsWith('--') ? (
                  <span className="text-muted-foreground italic">{line}</span>
                ) : line.includes('limit_req') || line.includes('return') || line.includes('add_header') || line.includes('server') || line.includes('location') ? (
                  <span>
                    {line.split(/(limit_req_zone|limit_req_status|limit_req|add_header|return|server|location)/g).map((chunk, cIdx) => {
                      if (['limit_req_zone', 'limit_req_status', 'limit_req', 'add_header', 'return', 'server', 'location'].includes(chunk)) {
                        return <span key={cIdx} className="text-primary font-semibold">{chunk}</span>;
                      }
                      if (chunk.includes('429') || chunk.includes('20')) {
                        return <span key={cIdx} className="text-amber-500 dark:text-amber-300">{chunk}</span>;
                      }
                      return <span key={cIdx}>{chunk}</span>;
                    })}
                  </span>
                ) : (
                  <span>{line}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
