import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { LimitDimension } from './RateLimitConfigSection';
import { RateLimitCondition } from './RateLimitConditionsSection';

interface RateLimitPreviewProps {
  name: string;
  policy: string;
  priority: number;
  enabled: boolean;
  dimension: LimitDimension;
  rateLimit: number;
  rateUnit: string;
  burst: number;
  actionExceeded: string;
  customResponse: boolean;
  responseCode: string;
  responseBody: string;
  conditions: RateLimitCondition[];
}

export function RateLimitPreviewPanel(props: RateLimitPreviewProps) {
  const [tab, setTab] = useState<'nginx' | 'lua' | 'json'>('nginx');
  const [copied, setCopied] = useState(false);

  // Derive variable key based on dimension
  let keyVar = '$binary_remote_addr';
  if (props.dimension === 'api_key') keyVar = '$http_x_api_key';
  if (props.dimension === 'user') keyVar = '$http_authorization';
  if (props.dimension === 'path') keyVar = '$uri';

  // Zone rate string
  let rateSuffix = 'r/m';
  if (props.rateUnit === '1 second') rateSuffix = 'r/s';
  if (props.rateUnit === '1 hour') rateSuffix = 'r/h';

  const zoneName = `limit_${props.name ? props.name.replace(/[^a-zA-Z0-9_]/g, '_') : 'zone'}`;
  const firstPath = props.conditions.find((c) => c.field === 'Request Path')?.value || '/login';

  const nginxContent = `# Rate limit: ${props.name || 'unnamed-limit'}
limit_req_zone ${keyVar} zone=${zoneName}:10m
               rate=${props.rateLimit}${rateSuffix};

server {
    location ${firstPath} {
        limit_req zone=${zoneName}${props.burst > 0 ? ` burst=${props.burst}` : ''} nodelay;
        limit_req_status ${props.responseCode || '429'};

        add_header Content-Type "application/json";
        return ${props.responseCode || '429'} '${props.responseBody.replace(/\n\s*/g, '')}';
    }
}`;

  const luaContent = `-- Generated Lua evaluation handler for ${props.name || 'rate_limit'}
local limit_req = require "resty.limit.req"
local lim, err = limit_req.new("${zoneName}", ${props.rateLimit}, ${props.burst})
if not lim then
    ngx.log(ngx.ERR, "failed to instantiate a resty.limit.req object: ", err)
    return ngx.exit(500)
end

local key = ${
    props.dimension === 'ip'
      ? 'ngx.var.binary_remote_addr'
      : props.dimension === 'api_key'
      ? 'ngx.req.get_headers()["x-api-key"]'
      : props.dimension === 'user'
      ? 'ngx.req.get_headers()["authorization"]'
      : 'ngx.var.uri'
  }
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
      policy: props.policy,
      priority: props.priority,
      enabled: props.enabled,
      dimension: props.dimension,
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
      match_conditions: props.conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        value: c.value,
      })),
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
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-3 font-mono text-xs">
      <div className="text-sm font-semibold text-white">Rule Preview</div>

      {/* Preview Tabs */}
      <div className="flex items-center justify-between border-b border-[#152030] bg-[#080E18]">
        <div className="flex overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('nginx')}
            className={`px-3 py-1.5 text-xs transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'nginx'
                ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            NGINX Config
          </button>
          <button
            type="button"
            onClick={() => setTab('lua')}
            className={`px-3 py-1.5 text-xs transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'lua'
                ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Lua Script (Generated)
          </button>
          <button
            type="button"
            onClick={() => setTab('json')}
            className={`px-3 py-1.5 text-xs transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'json'
                ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            JSON
          </button>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 px-2.5 py-1 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-300 hover:text-white text-[11px] cursor-pointer transition-colors m-1"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Code Window with line numbers */}
      <div className="bg-[#060A10] border border-[#152030] p-3 text-xs font-mono overflow-x-auto">
        <div className="space-y-0.5">
          {lines.map((line, idx) => (
            <div key={idx} className="flex leading-5">
              <span className="w-6 text-slate-600 select-none text-right pr-3 shrink-0">
                {idx + 1}
              </span>
              <span className="text-slate-300 whitespace-pre">
                {line.startsWith('#') || line.startsWith('--') ? (
                  <span className="text-slate-500 italic">{line}</span>
                ) : line.includes('limit_req') || line.includes('return') || line.includes('add_header') || line.includes('server') || line.includes('location') ? (
                  <span>
                    {line.split(/(limit_req_zone|limit_req_status|limit_req|add_header|return|server|location)/g).map((chunk, cIdx) => {
                      if (['limit_req_zone', 'limit_req_status', 'limit_req', 'add_header', 'return', 'server', 'location'].includes(chunk)) {
                        return <span key={cIdx} className="text-cyan-400 font-semibold">{chunk}</span>;
                      }
                      if (chunk.includes('429') || chunk.includes('20')) {
                        return <span key={cIdx} className="text-amber-300">{chunk}</span>;
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
