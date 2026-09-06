import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Check } from 'lucide-react';
import { CreateRateLimitHeader } from './sections/CreateRateLimitHeader';
import { RateLimitBasicInfoSection } from './sections/RateLimitBasicInfoSection';
import {
  RateLimitConfigSection,
  LimitDimension,
} from './sections/RateLimitConfigSection';
import {
  RateLimitConditionsSection,
  RateLimitCondition,
} from './sections/RateLimitConditionsSection';
import { RateLimitAdvancedSection } from './sections/RateLimitAdvancedSection';
import { RateLimitPreviewPanel } from './sections/RateLimitPreviewPanel';
import { RateLimitTesterPanel } from './sections/RateLimitTesterPanel';
import { RateLimitSummaryPanel } from './sections/RateLimitSummaryPanel';
import { RateLimitBehaviorPanel } from './sections/RateLimitBehaviorPanel';

export function CreateRateLimitPage() {
  const navigate = useNavigate();

  // Basic Info
  const [name, setName] = useState('limit-login-attempts');
  const [description, setDescription] = useState(
    'Limit login requests to prevent brute force attacks.'
  );
  const [policy, setPolicy] = useState('Default Policy');
  const [enabled, setEnabled] = useState(true);
  const [priority, setPriority] = useState(100);

  // Rate Limit Config
  const [dimension, setDimension] = useState<LimitDimension>('ip');
  const [rateLimit, setRateLimit] = useState(10);
  const [rateUnit, setRateUnit] = useState('1 minute');
  const [burst, setBurst] = useState(20);
  const [actionExceeded, setActionExceeded] = useState('block_429');
  const [customResponse, setCustomResponse] = useState(true);
  const [responseCode, setResponseCode] = useState('429');
  const [responseBody, setResponseBody] = useState(
    '{\n  "error": "rate_limited",\n  "message": "Too many requests. Please try again later."\n}'
  );

  // Match Conditions
  const [conditions, setConditions] = useState<RateLimitCondition[]>([
    {
      id: '1',
      field: 'Request Path',
      operator: 'Starts With',
      value: '/login',
    },
  ]);

  // Advanced Options
  const [logEvents, setLogEvents] = useState(true);
  const [addReputation, setAddReputation] = useState(false);
  const [enableAlert, setEnableAlert] = useState(false);

  // Submitting state
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // Simulate save
    await new Promise((r) => setTimeout(r, 600));
    setSubmitting(false);
    setSuccess(true);
    setTimeout(() => {
      navigate('/rate-limits');
    }, 800);
  };

  return (
    <div className="p-6 w-full space-y-5">
      {/* Header */}
      <CreateRateLimitHeader />

          {/* Success Notification */}
          {success && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-500/60 text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Rate Limit Rule created successfully! Redirecting...</span>
            </div>
          )}

          {/* Grid Layout: Left form, Right panels */}
          <form
            onSubmit={handleCreateRule}
            className="grid grid-cols-1 lg:grid-cols-12 gap-5"
          >
            {/* Left Column (Inputs: Sections 1 - 4) */}
            <div className="lg:col-span-7 space-y-4">
              <RateLimitBasicInfoSection
                name={name}
                setName={setName}
                description={description}
                setDescription={setDescription}
                policy={policy}
                setPolicy={setPolicy}
                enabled={enabled}
                setEnabled={setEnabled}
                priority={priority}
                setPriority={setPriority}
              />

              <RateLimitConfigSection
                dimension={dimension}
                setDimension={setDimension}
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

              <RateLimitConditionsSection
                conditions={conditions}
                setConditions={setConditions}
              />

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
                  className="px-4 py-2 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-300 hover:text-white text-xs cursor-pointer transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs shadow-lg shadow-blue-900/30 cursor-pointer transition-colors disabled:opacity-50"
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
                policy={policy}
                priority={priority}
                enabled={enabled}
                dimension={dimension}
                rateLimit={rateLimit}
                rateUnit={rateUnit}
                burst={burst}
                actionExceeded={actionExceeded}
                customResponse={customResponse}
                responseCode={responseCode}
                responseBody={responseBody}
                conditions={conditions}
              />

              <RateLimitTesterPanel rateLimit={rateLimit} />

              <RateLimitSummaryPanel
                name={name}
                actionExceeded={actionExceeded}
                rateLimit={rateLimit}
                rateUnit={rateUnit}
                burst={burst}
                conditions={conditions}
                policy={policy}
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
