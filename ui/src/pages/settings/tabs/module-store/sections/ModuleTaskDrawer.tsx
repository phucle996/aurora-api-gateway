import React from 'react';
import {
  X,
  RotateCw,
  CheckCircle2,
  XCircle,
  Clock,
  Terminal,
  Cpu,
  FileCheck2,
  FileCode,
  RefreshCw,
  Zap,
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
  id: number;
  name: string;
  description: string;
  icon: React.ReactNode;
}

const INSTALL_STEPS: StepItem[] = [
  {
    id: 1,
    name: 'Kiểm tra tương thích',
    description: 'Xác thực kiến trúc CPU và phiên bản NGINX ABI',
    icon: <Cpu className="w-4 h-4" />,
  },
  {
    id: 2,
    name: 'Xác thực Checksum SHA256',
    description: 'Kiểm tra tính toàn vẹn gói binary .so không bị sửa đổi',
    icon: <FileCheck2 className="w-4 h-4" />,
  },
  {
    id: 3,
    name: 'Cấu hình candidate & Cú pháp',
    description: 'Tạo modules.conf và chạy thử nghiệm nginx -t',
    icon: <FileCode className="w-4 h-4" />,
  },
  {
    id: 4,
    name: 'Atomic Symlink & SIGHUP Reload',
    description: 'Hoán đổi liên kết /current và gửi tín hiệu reload tới Master Process',
    icon: <RefreshCw className="w-4 h-4" />,
  },
  {
    id: 5,
    name: 'Kiểm thử Runtime HTTP Response',
    description: 'Xác nhận request phản hồi thực tế đạt tiêu chuẩn trước khi xác nhận',
    icon: <Zap className="w-4 h-4" />,
  },
];

export function ModuleTaskDrawer({
  nodeId,
  jobId,
  jobAction,
  jobState,
  jobMessage,
  jobLogs,
  onClose,
  onRetry,
}: ModuleTaskDrawerProps) {
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
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col font-sans">
      {/* Drawer Header */}
      <div className="p-4 border-b border-border flex items-center justify-between bg-muted/40">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            Tiến trình tác vụ ({nodeId})
          </span>
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
      <div className="p-5 flex-1 overflow-y-auto space-y-6 text-xs">
        {/* Task Overview Box */}
        <div className="p-3.5 border border-border bg-muted/20 rounded-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-muted-foreground text-[11px]">Mã Job: #{jobId}</span>
            <div className="flex items-center gap-1.5">
              {isRunning && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-500/40 text-blue-600 dark:text-blue-400 font-semibold text-[10px] rounded-xs">
                  <RotateCw className="w-3 h-3 animate-spin" />
                  Đang thực thi
                </span>
              )}
              {isSucceeded && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-500/40 text-emerald-600 dark:text-emerald-400 font-semibold text-[10px] rounded-xs">
                  <CheckCircle2 className="w-3 h-3" />
                  Thành công
                </span>
              )}
              {isFailed && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-500/40 text-rose-600 dark:text-rose-400 font-semibold text-[10px] rounded-xs">
                  <XCircle className="w-3 h-3" />
                  Thất bại
                </span>
              )}
            </div>
          </div>
          <div className="font-medium text-foreground text-sm">{actionDisplay}</div>
          {jobMessage && (
            <div className="p-2 bg-background border border-border rounded-xs font-mono text-[11px] text-muted-foreground break-words">
              {jobMessage}
            </div>
          )}
          {jobLogs && (
            <div className="mt-2 space-y-1">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Terminal className="w-3 h-3 text-primary" />
                <span>Nhật ký thực thi (Live Logs)</span>
              </div>
              <pre className="p-2.5 bg-zinc-950 text-zinc-200 border border-border rounded-xs font-mono text-[10.5px] leading-relaxed overflow-x-auto max-h-48 whitespace-pre-wrap selection:bg-primary/40">
                {jobLogs}
              </pre>
            </div>
          )}
        </div>

        {/* Stepper Pipeline */}
        <div>
          <h4 className="font-semibold text-foreground text-xs uppercase tracking-wider mb-3 text-slate-400">
            Quy trình thực thi an toàn (Safe Pipeline)
          </h4>
          <div className="space-y-4 relative pl-4 border-l-2 border-border ml-2">
            {INSTALL_STEPS.map((step, idx) => {
              const stepDone = isSucceeded;
              const stepActive = isRunning && idx === 3;
              return (
                <div key={step.id} className="relative">
                  {/* Step Dot */}
                  <div
                    className={`absolute -left-[23px] top-0 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                      stepDone
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : stepActive
                          ? 'bg-primary border-primary animate-pulse'
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

        {/* Automation Guarantees */}
        <div className="p-3 bg-muted/40 border border-border rounded-xs space-y-1.5 font-mono text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5 text-foreground font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>Cam kết vận hành WAF:</span>
          </div>
          <p className="leading-relaxed">
            Hệ thống luôn thực hiện Rollback tự động về cấu hình ổn định trước đó nếu bước kiểm thử thất bại, không gây gián đoạn các kết nối HTTP đang hoạt động.
          </p>
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
