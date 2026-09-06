import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import logoImg from '@/assets/logo.png';
import { api, setAuthToken, setAuthUser } from '../../../lib/fetcher';

export function LoginForm() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setErrorMessage('');

    try {
      const data = await api.post('/api/v1/auth/login', {
        username: username.trim(),
        password: password,
      });

      if (data && data.token) {
        setAuthToken(data.token);
        if (data.user) {
          setAuthUser(data.user);
        }
        setIsSuccess(true);
        setTimeout(() => {
          navigate('/dashboard');
        }, 600);
      } else {
        throw new Error('No token returned by server');
      }
    } catch (err: any) {
      setErrorMessage(
        err?.data?.error || err?.message || 'Authentication failed. Please check your credentials.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="lg:col-span-7 bg-card border border-border p-8 md:p-10 shadow-2xl flex flex-col justify-between">
      <div>
        <div className="mb-6">
          <div className="flex items-center gap-2.5 mb-2">
            <img
              src={logoImg}
              alt="Aurora Logo"
              className="w-7 h-7 object-contain drop-shadow-[0_2px_6px_rgba(16,185,129,0.2)]"
            />
            <span className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">
              CONSOLE ACCESS
            </span>
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight mt-1 font-sans">
            Sign in to Aurora WAF
          </h1>
          <p className="text-xs text-muted-foreground mt-1 font-sans">
            Enterprise Cloud Defense & Security Management
          </p>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Success Alert */}
        {isSuccess && (
          <div className="mb-4 p-3 bg-primary/10 border border-primary/30 text-primary text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
            <span>Authenticated successfully! Redirecting to Console...</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
          {/* Username */}
          <div>
            <label
              htmlFor="username"
              className="block text-[11px] font-medium uppercase tracking-wider text-foreground mb-1.5"
            >
              Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                className="w-full bg-background border border-input pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                required
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label
              htmlFor="password"
              className="block text-[11px] font-medium uppercase tracking-wider text-foreground mb-1.5"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full bg-background border border-input pl-9 pr-9 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Remember this device & Forgot password */}
          <div className="flex items-center justify-between pt-1 text-xs">
            <div className="flex items-center gap-2">
              <input
                id="remember"
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="w-3.5 h-3.5 border-input bg-background text-primary focus:ring-0 transition-colors cursor-pointer accent-primary"
              />
              <label
                htmlFor="remember"
                className="text-[11px] text-muted-foreground hover:text-foreground select-none cursor-pointer"
              >
                Remember this device
              </label>
            </div>

            <a
              href="#forgot-password"
              className="text-[11px] text-primary hover:text-primary/80 font-medium transition-colors"
            >
              Forgot password?
            </a>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={isLoading || isSuccess}
            className="w-full bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground text-xs font-semibold py-2.5 flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-3 uppercase tracking-wider font-sans"
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white animate-spin" />
            ) : isSuccess ? (
              <span>Authenticated</span>
            ) : (
              <>
                <span>Sign in to Console</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>

      {/* Security notice bottom */}
      <div className="mt-8 pt-4 border-t border-border flex items-center gap-2 text-muted-foreground text-xs">
        <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
        <span>
          Protected by Aurora WAF Enterprise Security Engine.
        </span>
      </div>
    </div>
  );
}
