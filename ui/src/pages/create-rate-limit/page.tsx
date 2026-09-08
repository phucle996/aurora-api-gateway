import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Check } from 'lucide-react';
import { CreateRateLimitHeader } from './sections/CreateRateLimitHeader';
import { RateLimitBasicInfoSection } from './sections/RateLimitBasicInfoSection';
import {
  RateLimitConfigSection,
  DimensionType,
  IpConfig,
  HeaderMatchConfig,
  PathScopeConfig,
} from './sections/RateLimitConfigSection';
import { RateLimitAdvancedSection } from './sections/RateLimitAdvancedSection';
import { RateLimitPreviewPanel } from './sections/RateLimitPreviewPanel';
import { RateLimitSummaryPanel } from './sections/RateLimitSummaryPanel';
import { RateLimitBehaviorPanel } from './sections/RateLimitBehaviorPanel';

import { rateLimitsApi } from '../../lib/api/rate-limits';
import { AlertCircle } from 'lucide-react';

const DEFAULT_RESPONSE_BODY = `{
  "error": "rate_limited",
  "status": 429,
  "message": "Too many requests. Please slow down and try again later.",
  "retry_after": 60
}`;

export function CreateRateLimitPage() {
  const navigate = useNavigate();

  // 1. Basic Info (Name & Description only)
  const [name, setName] = useState('limit-login-attempts');
  const [description, setDescription] = useState(
    'Limit login requests to prevent brute force attacks.'
  );

  // 2. Rate Limit Config (Combined Keys: IP, Header, Path)
  const [enabledDimensions, setEnabledDimensions] = useState<DimensionType[]>([
    'ip',
    'path',
  ]);
  const [dimensionOrder, setDimensionOrder] = useState<DimensionType[]>([
    'ip',
    'path',
  ]);

  const [ipConfig, setIpConfig] = useState<IpConfig>({
    source: 'binary_remote_addr',
    subnetMask: '/32',
  });

  const [headerConfig, setHeaderConfig] = useState<HeaderMatchConfig>({
    headerName: 'X-API-Key',
    operator: 'equals',
    headerValue: '',
    caseSensitive: false,
  });

  const [pathConfig, setPathConfig] = useState<PathScopeConfig>({
    path: '/api/login',
    matchType: 'prefix',
  });

  const [rateLimit, setRateLimit] = useState(10);
  const [rateUnit, setRateUnit] = useState('1 minute');
  const [burst, setBurst] = useState(20);
  const [actionExceeded, setActionExceeded] = useState('block_429');
  const [customResponse, setCustomResponse] = useState(true);
  const [responseCode, setResponseCode] = useState('429');
  const [responseBody, setResponseBody] = useState(DEFAULT_RESPONSE_BODY);

  // Advanced Options
  const [logEvents, setLogEvents] = useState(true);
  const [addReputation, setAddReputation] = useState(false);
  const [enableAlert, setEnableAlert] = useState(false);

  // Submitting & Feedback state
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');

    try {
      await rateLimitsApi.create({
        name: name.trim(),
        description: description.trim(),
        enabled_dimensions: enabledDimensions,
        dimension_order: dimensionOrder,
        ip_config: {
          source: ipConfig.source,
          subnet_mask: ipConfig.subnetMask,
        },
        header_config: {
          header_name: headerConfig.headerName,
          operator: headerConfig.operator,
          header_value: headerConfig.headerValue,
          case_sensitive: headerConfig.caseSensitive,
        },
        path_config: {
          path: pathConfig.path,
          match_type: pathConfig.matchType,
        },
        rate_limit: Number(rateLimit),
        rate_unit: rateUnit,
        burst: Number(burst),
        action_exceeded: actionExceeded,
        custom_response: customResponse,
        response_code: parseInt(responseCode, 10) || 429,
        response_body: responseBody,
        log_events: logEvents,
        add_reputation: addReputation,
        enable_alert: enableAlert,
        status: 'Active',
      });

      setSuccess(true);
      setTimeout(() => {
        navigate('/rate-limits');
      }, 800);
    } catch (err: any) {
      setErrorMsg(err?.data?.error || err?.message || 'Lỗi khi tạo rate limit rule');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 w-full space-y-5">
      {/* Header */}
      <CreateRateLimitHeader />

      {/* Error Notification */}
      {errorMsg && (
        <div className="p-3 bg-destructive/15 border border-destructive/40 text-destructive text-xs flex items-center gap-2 rounded-xs">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Success Notification */}
      {success && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/60 text-emerald-300 text-xs flex items-center gap-2 rounded-xs">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>Rate Limit Rule created successfully! Redirecting...</span>
        </div>
      )}

      {/* Grid Layout: Left form, Right panels */}
      <form
        onSubmit={handleCreateRule}
        className="grid grid-cols-1 lg:grid-cols-12 gap-5"
      >
        {/* Left Column (Inputs: Sections 1, 2, Advanced) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Section 1: Basic Information */}
          <RateLimitBasicInfoSection
            name={name}
            setName={setName}
            description={description}
            setDescription={setDescription}
          />

          {/* Section 2: Rate Limit Configuration */}
          <RateLimitConfigSection
            enabledDimensions={enabledDimensions}
            setEnabledDimensions={setEnabledDimensions}
            dimensionOrder={dimensionOrder}
            setDimensionOrder={setDimensionOrder}
            ipConfig={ipConfig}
            setIpConfig={setIpConfig}
            headerConfig={headerConfig}
            setHeaderConfig={setHeaderConfig}
            pathConfig={pathConfig}
            setPathConfig={setPathConfig}
            rateLimit={rateLimit}
            setRateLimit={setRateLimit}
            rateUnit={rateUnit}
            setRateUnit={setRateUnit}
            burst={burst}
            setBurst={setBurst}
            actionExceeded={actionExceeded}
            setActionExceeded={setActionExceeded}
            customResponse={customResponse}
            setCustomResponse={setCustomResponse}
            responseCode={responseCode}
            setResponseCode={setResponseCode}
            responseBody={responseBody}
            setResponseBody={setResponseBody}
          />

          {/* Advanced Options */}
          <RateLimitAdvancedSection
            logEvents={logEvents}
            setLogEvents={setLogEvents}
            addReputation={addReputation}
            setAddReputation={setAddReputation}
            enableAlert={enableAlert}
            setEnableAlert={setEnableAlert}
          />

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate('/rate-limits')}
              className="px-4 py-2 bg-card hover:bg-muted border border-border text-foreground text-xs cursor-pointer transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-xs cursor-pointer transition-colors disabled:opacity-50 shadow-xs"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{submitting ? 'Creating Rule...' : 'Create Rule'}</span>
            </button>
          </div>
        </div>

        {/* Right Column (Panels) */}
        <div className="lg:col-span-5 space-y-4">
          <RateLimitPreviewPanel
            name={name}
            enabledDimensions={enabledDimensions}
            dimensionOrder={dimensionOrder}
            ipConfig={ipConfig}
            headerConfig={headerConfig}
            pathConfig={pathConfig}
            rateLimit={rateLimit}
            rateUnit={rateUnit}
            burst={burst}
            actionExceeded={actionExceeded}
            customResponse={customResponse}
            responseCode={responseCode}
            responseBody={responseBody}
          />

          <RateLimitSummaryPanel
            name={name}
            actionExceeded={actionExceeded}
            rateLimit={rateLimit}
            rateUnit={rateUnit}
            burst={burst}
            enabledDimensions={enabledDimensions}
            dimensionOrder={dimensionOrder}
            pathConfig={pathConfig}
            headerConfig={headerConfig}
            logEvents={logEvents}
            enableAlert={enableAlert}
          />

          <RateLimitBehaviorPanel
            rateLimit={rateLimit}
            rateUnit={rateUnit}
            burst={burst}
          />
        </div>
      </form>
    </div>
  );
}

export default CreateRateLimitPage;

