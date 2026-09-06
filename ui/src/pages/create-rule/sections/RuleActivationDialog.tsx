import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ShieldAlert, Zap, Clock } from 'lucide-react';

interface RuleActivationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruleName: string;
  isSaving?: boolean;
  onConfirm: (enableNow: boolean) => void;
}

export function RuleActivationDialog({
  open,
  onOpenChange,
  ruleName,
  isSaving = false,
  onConfirm,
}: RuleActivationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="font-sans sm:max-w-md bg-card border-border text-foreground p-5 shadow-2xl">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-foreground">
                Kích hoạt Rule / Rule Activation
              </DialogTitle>
              <div className="text-[11px] text-muted-foreground">
                Xác nhận trạng thái trước khi lưu
              </div>
            </div>
          </div>

          <DialogDescription className="text-xs text-foreground/80 pt-2 leading-relaxed">
            Bạn muốn bật rule này ngay lập tức để áp dụng chính sách bảo vệ hay lưu ở trạng thái tắt để kích hoạt sau?
          </DialogDescription>
        </DialogHeader>

        {ruleName && (
          <div className="bg-muted/50 border border-border p-3 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Tên Rule:</span>
              <span className="font-semibold text-foreground">{ruleName}</span>
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-border/50">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
            className="px-3.5 py-2 bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border text-xs font-mono transition-colors cursor-pointer"
          >
            Hủy
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => onConfirm(false)}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border text-xs font-bold font-mono transition-colors cursor-pointer"
          >
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span>Để sau</span>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => onConfirm(true)}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold font-mono transition-colors cursor-pointer shadow-sm"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Bật ngay</span>
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
