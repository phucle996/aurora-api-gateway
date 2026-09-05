import React from 'react';
import {
  Shield,
  Lock,
  Users,
  ShieldCheck,
  FileText,
  Sliders,
  HelpCircle,
  BookOpen,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';

export function LoginInfoCards() {
  return (
    <div className="lg:col-span-5 flex flex-col gap-3 justify-between font-mono">
      {/* Card 1: Access Notice */}
      <div className="bg-[#0C121E] border border-[#1C2739] p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
          <h2 className="text-xs font-semibold text-white tracking-wider uppercase font-sans">
            Access Notice
          </h2>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed font-sans">
          This console is restricted to authorized administrators only.
        </p>
        <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
          Unauthorized access is prohibited and subject to automated audit recording.
        </p>
      </div>

      {/* Card 2: Security Controls */}
      <div className="bg-[#0C121E] border border-[#1C2739] p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
          <h2 className="text-xs font-semibold text-white tracking-wider uppercase font-sans">
            Security Controls
          </h2>
        </div>
        <p className="text-[11px] text-slate-500 mb-3 font-sans">
          Built with security best practices for enterprise edge workloads.
        </p>

        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>SSO / OIDC Ready</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>MFA Policy Enforced</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Immutable Audit Logging</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <Sliders className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Granular RBAC Permissions</span>
          </div>
        </div>
      </div>

      {/* Card 3: Help & Documentation */}
      <div className="bg-[#0C121E] border border-[#1C2739] p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-2">
          <HelpCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          <h2 className="text-xs font-semibold text-white tracking-wider uppercase font-sans">
            Documentation & Support
          </h2>
        </div>
        <div className="space-y-2 text-xs">
          <a
            href="#docs"
            className="flex items-center justify-between text-slate-300 hover:text-emerald-400 transition-colors"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5 text-slate-400" />
              <span>Aurora WAF Admin Guide</span>
            </div>
            <ExternalLink className="w-3 h-3 text-slate-500" />
          </a>
          <a
            href="#support"
            className="flex items-center justify-between text-slate-300 hover:text-emerald-400 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              <span>Contact Security Operations</span>
            </div>
            <ExternalLink className="w-3 h-3 text-slate-500" />
          </a>
        </div>
      </div>
    </div>
  );
}
