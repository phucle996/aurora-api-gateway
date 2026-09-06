import React from 'react';
import { Link } from 'react-router-dom';

export function CreateRateLimitHeader() {
  return (
    <div className="space-y-1 font-sans">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <Link to="/rate-limits" className="hover:text-white transition-colors">
          Rate Limiting
        </Link>
        <span>/</span>
        <span className="text-slate-200">Create Rule</span>
      </div>

      {/* Title & Subtitle */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight font-sans">
          Create Rate Limit Rule
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Protect your services from abuse by limiting the number of requests from clients.
        </p>
      </div>
    </div>
  );
}
