import React from 'react';
import {
  Bell,
  Mail,
  Send,
  MessageSquare,
  Bot,
  Globe,
  Radio,
} from 'lucide-react';
import type { NotificationChannelId } from '../../../../../lib/api';

export function getChannelIcon(id: NotificationChannelId) {
  switch (id) {
    case 'email':
      return <Mail className="w-4 h-4 text-emerald-500" />;
    case 'slack':
      return <MessageSquare className="w-4 h-4 text-amber-500" />;
    case 'telegram':
      return <Send className="w-4 h-4 text-sky-500" />;
    case 'discord':
      return <Bot className="w-4 h-4 text-indigo-500" />;
    case 'webhook':
      return <Globe className="w-4 h-4 text-cyan-500" />;
    case 'pagerduty':
      return <Radio className="w-4 h-4 text-rose-500" />;
    default:
      return <Bell className="w-4 h-4 text-primary" />;
  }
}

export function getSeverityBadge(severity: string) {
  switch (severity) {
    case 'critical':
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20">
          CRITICAL
        </span>
      );
    case 'high':
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20">
          HIGH
        </span>
      );
    case 'medium':
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20">
          MEDIUM
        </span>
      );
    default:
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-muted text-muted-foreground border border-border">
          LOW
        </span>
      );
  }
}
