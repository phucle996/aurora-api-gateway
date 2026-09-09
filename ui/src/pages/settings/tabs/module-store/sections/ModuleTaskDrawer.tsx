import React, { useEffect, useState, useRef } from 'react';
import {
  X,
  RotateCw,
  CheckCircle2,
  XCircle,
  Terminal,
  Cpu,
  FileCheck2,
  FileCode,
  RefreshCw,
  Zap,
  Activity,
  ShieldCheck,
  Radio,
} from 'lucide-react';

interface ModuleTaskDrawerProps {
  nodeId: string;
  jobId: number;
  jobAction: string;
  jobState: string;
  jobMessage: string;
  jobLogs?: string;
  onClose: () => void;
  onRetry?: () => void;
}

interface StepItem {
  id: string;
  name: string;
  description: string;
  threshold: number;
  icon: React.ReactNode;
}

const CANARY_PIPELINE_STEPS: StepItem[] = [
  {
    id: 'PREFLIGHT',
    name: '1. Preflight ABI & Checksum',
    description: 'Xác thực ABI NGINX và toàn vẹn gói SHA256SUMS',
    threshold: 15,
    icon: <Cpu className="w-4 h-4" />,
  },
  {
    id: 'SYNTAX_CHECK',
    name: '2. Cấu hình candidate & Syntax',
    description: 'Tạo modules.conf và kiểm thử dynamic link (nginx -t)',
    threshold: 35,
    icon: <FileCode className="w-4 h-4" />,
  },
  {
    id: 'CANARY_PROBE',
    name: '3. Isolated Canary Test Harness',
    description: 'Kiểm thử phản hồi nén/runtime trên port cách ly nội bộ',
    threshold: 55,
    icon: <Zap className="w-4 h-4" />,
  },
  {
    id: 'SAFE_RELOAD',
    name: '4. Graceful Reload & Worker Draining',
    description: 'Hoán đổi atomic symlink; req cũ đi worker cũ, req mới đi worker mới',
    threshold: 75,
    icon: <RefreshCw className="w-4 h-4" />,
  },
  {
    id: 'CANARY_OBSERVATION',
    name: '5. Cửa sổ quan sát (Observation Window)',
    description: 'Theo dõi sự ổn định của worker và bảo đảm không có lỗi runtime',
    threshold: 90,
    icon: <Activity className="w-4 h-4" />,
  },
  {
    id: 'COMMIT',
    name: '6. Hoàn tất & Kích hoạt an toàn',
    description: 'Module chính thức hoạt động phục vụ 100% workload',
    threshold: 100,
    icon: <ShieldCheck className="w-4 h-4" />,
  },
];

export function ModuleTaskDrawer({
  nodeId,
  jobId,
  jobAction,
  jobState: initialJobState,
  jobMessage: initialJobMessage,
  jobLogs: initialJobLogs,
  onClose,
  onRetry,
}: ModuleTaskDrawerProps) {
  const [jobState, setJobState] = useState<string>(initialJobState);
  const [jobMessage, setJobMessage] = useState<string>(initialJobMessage);
  const [liveLogs, setLiveLogs] = useState<string>(initialJobLogs || '');
  const [progress, setProgress] = useState<number>(() => {
    if (initialJobState === 'succeeded') return 100;
    if (initialJobState === 'failed') return 0;
    return 15;
  });
  const [currentStage, setCurrentStage] = useState<string>('PREFLIGHT');
  const [isSseConnected, setIsSseConnected] = useState<boolean>(false);

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Sync initial props
  useEffect(() => {
    setJobState(initialJobState);
    setJobMessage(initialJobMessage);
    if (initialJobLogs && !liveLogs) {
      setLiveLogs(initialJobLogs);
    }
  }, [initialJobState, initialJobMessage, initialJobLogs]);

  // Real-time SSE listener
  useEffect(() => {
    if (!jobId || jobId <= 0) return;

    const sseUrl = `/api/v1/settings/modules/jobs/${jobId}/events`;
    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      setIsSseConnected(true);
    };

    eventSource.addEventListener('init', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.state) setJobState(data.state);
        if (data.message) setJobMessage(data.message);
        if (data.logs) setLiveLogs(data.logs);
        if (typeof data.progress === 'number') setProgress(data.progress);
      } catch (err) {
        console.error('Lỗi parse SSE init:', err);
      }
    });

    eventSource.addEventListener('progress', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (typeof data.progress === 'number') setProgress(data.progress);
        if (data.stage) setCurrentStage(data.stage);
        if (data.message) setJobMessage(data.message);
        if (data.state) setJobState(data.state);
        if (data.log_chunk) {
          setLiveLogs((prev) => prev + data.log_chunk);
        }
      } catch (err) {
        console.error('Lỗi parse SSE progress:', err);
      }
    });

    eventSource.onerror = () => {
      setIsSseConnected(false);
      // EventSource tự động reconnect nếu đứt kết nối
    };

    return () => {
      eventSource.close();
      setIsSseConnected(false);
    };
  }, [jobId]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveLogs]);

  const isRunning = jobState === 'pending' || jobState === 'running';
  const isSucceeded = jobState === 'succeeded';
  const isFailed = jobState === 'failed';

  const actionDisplay =
    jobAction === 'install_brotli'
      ? 'Cài đặt Google Brotli Module'
      : jobAction === 'check'
        ? 'Kiểm tra toàn bộ Modules'
        : jobAction;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-card border-l border-border shadow-2xl flex flex-col font-sans">
      {/* Drawer Header */}
      <div className="p-4 border-b border-border flex items-center justify-between bg-muted/40">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-primary" />
          <div>
            <span className="text-sm font-semibold text-foreground">
              Tiến trình tác vụ ({nodeId})
            </span>
            <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground mt-0.5">
              <span>Mã Job: #{jobId}</span>
              <span>•</span>
              <span className="flex items-center gap-1 font-mono">
                <Radio
                  className={`w-2.5 h-2.5 ${isSseConnected ? 'text-emerald-500 animate-pulse' : 'text-zinc-400'}`}
                />
                {isSseConnected ? 'SSE Live Stream' : 'Kết nối...'}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-xs"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drawer Body */}
      <div className="p-5 flex-1 overflow-y-auto space-y-5 text-xs">
        {/* Real-time Progress Bar Box */}
        <div className="p-4 border border-border bg-muted/20 rounded-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-foreground text-sm">{actionDisplay}</div>
            <div className="flex items-center gap-1.5">
              {isRunning && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-500/40 text-blue-600 dark:text-blue-400 font-semibold text-[11px] rounded-xs">
                  <RotateCw className="w-3 h-3 animate-spin" />
                  Đang thực thi ({progress}%)
                </span>
              )}
              {isSucceeded && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px] rounded-xs">
                  <CheckCircle2 className="w-3 h-3" />
                  Hoàn tất an toàn (100%)
                </span>
              )}
              {isFailed && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-500/40 text-rose-600 dark:text-rose-400 font-semibold text-[11px] rounded-xs">
                  <XCircle className="w-3 h-3" />
                  Thất bại (Đã Rollback)
                </span>
              )}
            </div>
          </div>

          {/* Animated Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground font-medium flex items-center gap-1.5">
                <Activity className="w-3 h-3 text-primary" />
                Giai đoạn: <strong className="text-foreground">{currentStage}</strong>
              </span>
              <span className="font-mono font-bold text-primary">{progress}%</span>
            </div>
            <div className="w-full bg-muted/60 h-2.5 rounded-full overflow-hidden border border-border/40">
              <div
                className={`h-full transition-all duration-500 ease-out ${
                  isFailed
                    ? 'bg-rose-500'
                    : isSucceeded
                      ? 'bg-emerald-500'
                      : 'bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(progress, 5))}%` }}
              />
            </div>
          </div>

          {jobMessage && (
            <div className="p-2.5 bg-background border border-border rounded-xs font-mono text-[11px] text-muted-foreground break-words">
              {jobMessage}
            </div>
          )}
        </div>

        {/* Canary & Blue-Green Safety Guarantee Banner */}
        <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xs space-y-1.5">
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Cam kết Canary / Blue-Green Zero-Downtime:</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Hệ thống áp dụng cơ chế <strong>Worker Connection Draining</strong>: Các kết nối in-flight hiện tại tiếp tục được phục vụ trọn vẹn bởi Worker cũ. Kết nối mới được chuyển sang Worker đã nạp module mới. Nếu phát hiện bất kỳ lỗi nào trong cửa sổ quan sát, hệ thống sẽ <strong>tự động Rollback tức thì</strong>, đảm bảo 0% rủi ro đứt gãy workload.
          </p>
        </div>

        {/* 6-Stage Gate Visualizer */}
        <div>
          <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider mb-3 text-slate-400">
            Quy trình Canary Gate 6 chặng (Safe Pipeline)
          </h4>
          <div className="space-y-4 relative pl-4 border-l-2 border-border ml-2">
            {CANARY_PIPELINE_STEPS.map((step) => {
              const stepDone = isSucceeded || progress >= step.threshold;
              const stepActive = isRunning && progress < step.threshold && progress >= step.threshold - 20;
              const stepFailed = isFailed && progress < step.threshold;

              return (
                <div key={step.id} className="relative">
                  {/* Step Dot */}
                  <div
                    className={`absolute -left-[23px] top-0.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-colors ${
                      stepDone
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : stepActive
                          ? 'bg-primary border-primary animate-pulse'
                          : stepFailed
                            ? 'bg-rose-500 border-rose-500'
                            : 'bg-background border-border'
                    }`}
                  />
                  <div>
                    <div className="flex items-center gap-1.5 font-medium text-foreground text-xs">
                      {step.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {step.description}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Terminal Log Streamer */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-primary" />
              <span>Nhật ký thực thi trực tiếp (Live Terminal Output)</span>
            </div>
            {isSseConnected && isRunning && (
              <span className="text-[10px] text-emerald-500 animate-pulse font-mono font-normal">
                ● Streaming
              </span>
            )}
          </div>
          <div className="p-3 bg-zinc-950 text-zinc-200 border border-border rounded-xs font-mono text-[11px] leading-relaxed overflow-x-auto max-h-56 select-text">
            <pre className="whitespace-pre-wrap font-mono">
              {liveLogs || (
                <span className="text-zinc-500 italic">
                  Đang chờ node agent gửi dữ liệu kiểm thử...
                </span>
              )}
            </pre>
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>

      {/* Drawer Footer */}
      <div className="p-4 border-t border-border flex items-center justify-between bg-muted/20">
        <button
          type="button"
          onClick={onClose}
          className="px-3.5 py-1.5 border border-border text-xs text-foreground hover:bg-muted transition-colors cursor-pointer rounded-xs"
        >
          Đóng
        </button>

        {isFailed && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-1.5 bg-primary text-primary-foreground font-medium text-xs rounded-xs hover:bg-primary/90 transition-colors cursor-pointer"
          >
            Thử lại tác vụ
          </button>
        )}
      </div>
    </div>
  );
}
