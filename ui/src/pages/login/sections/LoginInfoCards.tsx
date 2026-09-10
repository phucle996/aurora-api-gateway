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
      <div className="bg-card border border-border p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-primary shrink-0" />
          <h2 className="text-xs font-semibold text-foreground tracking-wider uppercase font-sans">
            Access Notice
          </h2>
        </div>
        <p className="text-xs text-foreground leading-relaxed font-sans">
          This console is restricted to authorized administrators only.
        </p>
        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
          Unauthorized access is prohibited and subject to automated audit recording.
        </p>
      </div>

      {/* Card 2: Security Controls */}
      <div className="bg-card border border-border p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-primary shrink-0" />
          <h2 className="text-xs font-semibold text-foreground tracking-wider uppercase font-sans">
            Security Controls
          </h2>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3 font-sans">
          Built with security best practices for enterprise edge workloads.
        </p>

        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 text-foreground">
            <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span>SSO / OIDC Ready</span>
          </div>
          <div className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span>MFA Policy Enforced</span>
          </div>
          <div className="flex items-center gap-2 text-foreground">
            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span>Immutable Audit Logging</span>
          </div>
          <div className="flex items-center gap-2 text-foreground">
            <Sliders className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span>Granular RBAC Permissions</span>
          </div>
        </div>
      </div>

      {/* Card 3: Help & Documentation */}
      <div className="bg-card border border-border p-5 shadow-xl">
        <div className="flex items-center gap-2 mb-2">
          <HelpCircle className="w-4 h-4 text-primary shrink-0" />
          <h2 className="text-xs font-semibold text-foreground tracking-wider uppercase font-sans">
            Documentation & Support
          </h2>
        </div>
        <div className="space-y-2 text-xs">
          <a
            href="#docs"
            className="flex items-center justify-between text-foreground hover:text-primary transition-colors"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Aurora API Gateway Admin Guide</span>
            </div>
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
          </a>
          <a
            href="#support"
            className="flex items-center justify-between text-foreground hover:text-primary transition-colors"
          >
            <div className="flex items-center gap-2">
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
              <span>Contact Security Operations</span>
            </div>
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
          </a>
        </div>
      </div>
    </div>
  );
}
