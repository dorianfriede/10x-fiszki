import React, { useEffect, useRef } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  isPending?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
  onConfirm?: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  isPending = false,
  confirmDisabled = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={onCancel}
      onClick={(e) => {
        if (e.target === dialogRef.current && !isPending) onCancel();
      }}
      className="fixed top-1/2 left-1/2 m-0 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-900/95 p-6 text-white backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      {title && <p className="mb-2 font-semibold text-white">{title}</p>}
      <div className="mb-6 text-blue-100/80">{description}</div>

      {error && (
        <p className="mb-4 flex items-center gap-1 text-sm text-red-300">
          <CircleAlert className="size-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="ghost" disabled={isPending} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          type={onConfirm ? "button" : "submit"}
          variant={danger ? "destructive" : "default"}
          disabled={isPending || confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
