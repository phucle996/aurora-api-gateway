import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EditRuleHeader } from './sections/EditRuleHeader';
import { EditBasicInfoSection } from './sections/EditBasicInfoSection';
import { EditMatchConditionsSection } from './sections/EditMatchConditionsSection';
import { EditActionsSection } from './sections/EditActionsSection';
import { EditScopeSection } from './sections/EditScopeSection';
import { EditRulePreviewPanel } from './sections/EditRulePreviewPanel';
import { EditRuleTesterPanel } from './sections/EditRuleTesterPanel';
import { EditRuleInfoPanel } from './sections/EditRuleInfoPanel';
import type { Condition } from '../create-rule/sections/MatchConditionsSection';
import { Save, Play } from 'lucide-react';

export default function EditRulePage() {
  const navigate = useNavigate();

  // Form states
  const [ruleId] = useState('rule_01H8F3K9Z7');
  const [ruleName, setRuleName] = useState('block-sql-injection');
  const [description, setDescription] = useState(
    'Block common SQL injection patterns in URI and query parameters.'
  );
  const [policy, setPolicy] = useState('Default WAF Policy');
  const [enabled, setEnabled] = useState(true);
  const [priority, setPriority] = useState(100);

  const [conditions, setConditions] = useState<Condition[]>([
    {
      id: 'cond-1',
      field: 'Request URI',
      operator: 'Contains (Pattern)',
      value: '(?i)(union|select|insert|drop|or\\s+1=1)',
    },
    {
      id: 'cond-2',
      field: 'Query Parameter',
      operator: 'Contains (Pattern)',
      value: '(?i)(union|select|insert|drop|--|;|\\s+1=1)',
    },
    {
      id: 'cond-3',
      field: 'Request Body',
      operator: 'Contains (Pattern)',
      value: '(?i)(union|select|insert|drop|--|;|\\s+1=1)',
    },
  ]);
  const [logicMode, setLogicMode] = useState<'ALL' | 'ANY'>('ALL');

  const [actionType, setActionType] = useState('Block Request');
  const [responseCode, setResponseCode] = useState('403 Forbidden');
  const [customResponse, setCustomResponse] = useState(
    'Request blocked by security policy.'
  );
  const [logEvent, setLogEvent] = useState(true);
  const [addToReputation, setAddToReputation] = useState(false);

  const [sourceIP, setSourceIP] = useState('');
  const [hostDomain, setHostDomain] = useState('');
  const [pathPrefix, setPathPrefix] = useState('');
  const [httpMethod, setHttpMethod] = useState('All Methods');

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      alert(`Rule "${ruleName}" updated successfully!`);
      navigate('/rules');
    }, 600);
  };

  const handleDuplicate = () => {
    alert(`Rule "${ruleName}" duplicated as "${ruleName}-copy"!`);
    navigate('/rules/create');
  };

  const handleDelete = () => {
    if (window.confirm(`Are you sure you want to delete rule "${ruleName}"?`)) {
      alert(`Rule "${ruleName}" deleted.`);
      navigate('/rules');
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <EditRuleHeader
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onSave={handleSave}
        isSaving={isSaving}
      />

      {/* Form Layout: 2 Columns on desktop */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
      >
        {/* Left 7 cols: Form sections */}
        <div className="lg:col-span-7 space-y-5">
          {/* 1. Basic Information */}
          <EditBasicInfoSection
            ruleId={ruleId}
            name={ruleName}
            setName={setRuleName}
            description={description}
            setDescription={setDescription}
            policy={policy}
            setPolicy={setPolicy}
            enabled={enabled}
            setEnabled={setEnabled}
            priority={priority}
            setPriority={setPriority}
          />

          {/* 2. Match Conditions */}
          <EditMatchConditionsSection
            conditions={conditions}
            setConditions={setConditions}
            logicMode={logicMode}
            setLogicMode={setLogicMode}
          />

          {/* 3. Actions */}
          <EditActionsSection
            actionType={actionType}
            setActionType={setActionType}
            responseCode={responseCode}
            setResponseCode={setResponseCode}
            customResponse={customResponse}
            setCustomResponse={setCustomResponse}
            logEvent={logEvent}
            setLogEvent={setLogEvent}
            addToReputation={addToReputation}
            setAddToReputation={setAddToReputation}
          />

          {/* 4. Scope (Optional) */}
          <EditScopeSection
            sourceIP={sourceIP}
            setSourceIP={setSourceIP}
            hostDomain={hostDomain}
            setHostDomain={setHostDomain}
            pathPrefix={pathPrefix}
            setPathPrefix={setPathPrefix}
            httpMethod={httpMethod}
            setHttpMethod={setHttpMethod}
          />

          {/* Form Action Buttons */}
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => navigate('/rules')}
              className="px-4 py-2 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-300 hover:text-white text-xs font-mono transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  alert('Simulating live rule test against cluster nodes...');
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-cyan-400 hover:text-cyan-300 text-xs font-mono transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Test Rule</span>
              </button>

              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white text-xs font-bold font-mono transition-colors cursor-pointer shadow-sm"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right 5 cols: Panels */}
        <div className="lg:col-span-5 space-y-5">
          {/* Rule Preview */}
          <EditRulePreviewPanel
            name={ruleName}
            policy={policy}
            priority={priority}
            conditions={conditions}
            responseCode={responseCode}
          />

          {/* Test Rule */}
          <EditRuleTesterPanel conditions={conditions} />

          {/* Rule Information */}
          <EditRuleInfoPanel />
        </div>
      </form>
    </div>
  );
}
