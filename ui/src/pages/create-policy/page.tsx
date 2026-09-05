import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Save, ChevronRight } from 'lucide-react';
import { PolicyInfoSection } from './sections/PolicyInfoSection';
import { ScopeAssignmentSection } from './sections/ScopeAssignmentSection';
import { RuleGroupsSection } from './sections/RuleGroupsSection';
import { ResponseLoggingSection } from './sections/ResponseLoggingSection';
import { PolicySummaryPanel } from './sections/PolicySummaryPanel';

export default function CreatePolicyPage() {
  const navigate = useNavigate();

  // Form State initialized with values from screenshot mockup
  const [policyName, setPolicyName] = useState('Admin Console Strict');
  const [description, setDescription] = useState(
    'High-security policy for administrative interfaces with strict enforcement and enhanced protection against common attack vectors.'
  );
  const [mode, setMode] = useState('Blocking');
  const [priority, setPriority] = useState('High');
  const [status, setStatus] = useState('Draft');

  const [hostScope, setHostScope] = useState('admin.aurora.local');
  const [pathPattern, setPathPattern] = useState('/admin/*');
  const [assignedApp, setAssignedApp] = useState('Administrative Console');
  const [tags, setTags] = useState<string[]>(['admin', 'critical', 'internal']);

  const [selectedGroupNames, setSelectedGroupNames] = useState<string[]>([
    'SQL Injection',
    'XSS',
    'Path Traversal',
    'Command Injection',
    'Bad Bot Protection',
    'Sensitive Endpoint Protection',
    'Rate Limiting',
  ]);

  const [defaultAction, setDefaultAction] = useState('Block');
  const [returnStatus, setReturnStatus] = useState(403);
  const [eventLogging, setEventLogging] = useState('Enabled');
  const [auditTrail, setAuditTrail] = useState('Enabled');
  const [previewMode, setPreviewMode] = useState(false);

  const handleToggleGroup = (name: string) => {
    setSelectedGroupNames((prev) =>
      prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name]
    );
  };

  const handleAddTag = (tag: string) => {
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleCreatePolicy = () => {
    // In a full application, submit API mutation here
    navigate('/policies');
  };

  const handleSaveDraft = () => {
    navigate('/policies');
  };

  return (
    <div className="p-6 space-y-4 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Breadcrumbs & Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#152030]">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
            <Link to="/policies" className="hover:text-emerald-400 transition-colors">
              Policies
            </Link>
            <ChevronRight className="w-3 h-3 text-slate-600" />
            <span className="text-slate-200 font-semibold">Create Policy</span>
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">
              Create WAF Policy
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-blue-950/80 text-cyan-400 border border-cyan-700 uppercase">
              NEW RULESET
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono">
            Define enforcement rules, rate limits, and custom response behaviors for applications.
          </p>
        </div>
      </div>

      {/* 2-Column Main Form Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Form Column (8 columns) */}
        <div className="lg:col-span-8 space-y-4">
          <PolicyInfoSection
            policyName={policyName}
            onPolicyNameChange={setPolicyName}
            description={description}
            onDescriptionChange={setDescription}
            mode={mode}
            onModeChange={setMode}
            priority={priority}
            onPriorityChange={setPriority}
            status={status}
            onStatusChange={setStatus}
          />

          <ScopeAssignmentSection
            hostScope={hostScope}
            onHostScopeChange={setHostScope}
            pathPattern={pathPattern}
            onPathPatternChange={setPathPattern}
            assignedApp={assignedApp}
            onAssignedAppChange={setAssignedApp}
            tags={tags}
            onAddTag={handleAddTag}
            onRemoveTag={handleRemoveTag}
          />

          <RuleGroupsSection
            selectedGroupNames={selectedGroupNames}
            onToggleGroup={handleToggleGroup}
          />

          <ResponseLoggingSection
            defaultAction={defaultAction}
            onDefaultActionChange={setDefaultAction}
            returnStatus={returnStatus}
            onReturnStatusChange={setReturnStatus}
            eventLogging={eventLogging}
            onEventLoggingChange={setEventLogging}
            auditTrail={auditTrail}
            onAuditTrailChange={setAuditTrail}
            previewMode={previewMode}
            onPreviewModeToggle={() => setPreviewMode(!previewMode)}
          />
        </div>

        {/* Right Summary Panel Column (4 columns) */}
        <PolicySummaryPanel
          policyName={policyName}
          scope={hostScope}
          mode={mode}
          priority={priority}
          status={status}
          assignedApp={assignedApp}
          selectedGroups={selectedGroupNames}
          onCreatePolicy={handleCreatePolicy}
          onSaveDraft={handleSaveDraft}
        />
      </div>
    </div>
  );
}
