import React from 'react';
import { LoginHeader } from './sections/LoginHeader';
import { LoginForm } from './sections/LoginForm';
import { LoginInfoCards } from './sections/LoginInfoCards';
import { LoginFooter } from './sections/LoginFooter';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#070B12] text-slate-100 flex flex-col justify-between selection:bg-emerald-500/30 selection:text-emerald-200 relative overflow-x-hidden font-sans">
      {/* Background subtle dot matrix pattern */}
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Header */}
      <LoginHeader />

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center px-6 py-8 z-10">
        <div className="max-w-[1120px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <LoginForm />
          <LoginInfoCards />
        </div>
      </main>

      {/* Footer */}
      <LoginFooter />
    </div>
  );
}
