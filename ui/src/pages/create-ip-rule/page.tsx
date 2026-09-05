import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Check } from 'lucide-react';
import { CreateIpRuleHeader } from './sections/CreateIpRuleHeader';
import { IpBasicInfoSection } from './sections/IpBasicInfoSection';
import { IpSourceSection, SourceType } from './sections/IpSourceSection';
import { IpScopeSection } from './sections/IpScopeSection';
import { IpOptionsSection } from './sections/IpOptionsSection';
import { IpRulePreviewPanel } from './sections/IpRulePreviewPanel';
import { IpRuleSummaryPanel } from './sections/IpRuleSummaryPanel';

export function CreateIpRulePage() {
  const navigate = useNavigate();

  // Basic Info State
  const [name, setName] = useState('block-suspicious-country');
  const [description, setDescription] = useState('Block requests from high-risk countries.');
  const [action, setAction] = useState('block');
  const [enabled, setEnabled] = useState(true);
  const [priority, setPriority] = useState(100);

  // Source State
  const [sourceType, setSourceType] = useState<SourceType>('country');
  const [countries, setCountries] = useState<string[]>(['RU', 'CN', 'KP', 'IR']);
  const [ipValue, setIpValue] = useState('');
  const [cidrValue, setCidrValue] = useState('');
  const [asnValue, setAsnValue] = useState('');
  const [groupValue, setGroupValue] = useState('trusted-partners');

  // Scope State
  const [target, setTarget] = useState('*');
  const [path, setPath] = useState('');
  const [method, setMethod] = useState('*');
  const [timeWindow, setTimeWindow] = useState('always');

  // Additional Options State
  const [logEvent, setLogEvent] = useState(true);
  const [addReputation, setAddReputation] = useState(false);
  const [enableAlert, setEnableAlert] = useState(false);

  // Submit handling
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
      navigate('/ip-access');
    }, 800);
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <CreateIpRuleHeader />

          {/* Success Banner */}
          {success && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-500/60 text-emerald-300 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>IP & Access Control Rule created successfully! Redirecting...</span>
            </div>
          )}

          {/* Form & Preview Grid */}
          <form onSubmit={handleCreateRule} className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Column (Inputs: Sections 1 - 4) */}
            <div className="lg:col-span-7 space-y-4">
              <IpBasicInfoSection
                name={name}
                setName={setName}
                description={description}
                setDescription={setDescription}
                action={action}
                setAction={setAction}
                enabled={enabled}
                setEnabled={setEnabled}
                priority={priority}
                setPriority={setPriority}
              />

              <IpSourceSection
                sourceType={sourceType}
                setSourceType={setSourceType}
                countries={countries}
                setCountries={setCountries}
                ipValue={ipValue}
                setIpValue={setIpValue}
                cidrValue={cidrValue}
                setCidrValue={setCidrValue}
                asnValue={asnValue}
                setAsnValue={setAsnValue}
                groupValue={groupValue}
                setGroupValue={setGroupValue}
              />

              <IpScopeSection
                target={target}
                setTarget={setTarget}
                path={path}
                setPath={setPath}
                method={method}
                setMethod={setMethod}
                timeWindow={timeWindow}
                setTimeWindow={setTimeWindow}
              />

              <IpOptionsSection
                logEvent={logEvent}
                setLogEvent={setLogEvent}
                addReputation={addReputation}
                setAddReputation={setAddReputation}
                enableAlert={enableAlert}
                setEnableAlert={setEnableAlert}
              />

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => navigate('/ip-access')}
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

            {/* Right Column (Preview & Summary) */}
            <div className="lg:col-span-5 space-y-4">
              <IpRulePreviewPanel
                name={name}
                action={action}
                priority={priority}
                enabled={enabled}
                sourceType={sourceType}
                countries={countries}
                ipValue={ipValue}
                cidrValue={cidrValue}
                asnValue={asnValue}
                groupValue={groupValue}
                target={target}
                path={path}
                method={method}
                timeWindow={timeWindow}
                logEvent={logEvent}
                addReputation={addReputation}
                enableAlert={enableAlert}
              />

              <IpRuleSummaryPanel
                name={name}
                action={action}
                sourceType={sourceType}
                countries={countries}
                ipValue={ipValue}
                cidrValue={cidrValue}
                asnValue={asnValue}
                groupValue={groupValue}
                target={target}
                path={path}
                method={method}
                timeWindow={timeWindow}
                logEvent={logEvent}
                addReputation={addReputation}
                enableAlert={enableAlert}
              />
            </div>
          </form>
    </div>
  );
}

export default CreateIpRulePage;
