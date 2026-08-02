import React, { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  serverError?: string | null;
}

export default function CancelDeletionDialog({ serverError }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (serverError) {
      dialogRef.current?.showModal();
    }
  }, [serverError]);

  function openDialog() {
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <div>
      <Button
        type="button"
        onClick={openDialog}
        className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
      >
        Cancel deletion
      </Button>

      <dialog
        ref={dialogRef}
        onCancel={closeDialog}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeDialog();
        }}
        className="fixed top-1/2 left-1/2 m-0 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-900/95 p-6 text-white backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <p className="mb-6 text-blue-100/80">Cancel your account deletion request and restore full access?</p>

        <ServerError message={serverError} />

        <div className="mt-4 flex justify-end gap-3">
          <Button
            type="button"
            onClick={closeDialog}
            className="rounded-lg px-4 py-2 text-sm text-blue-100/80 transition hover:text-white"
          >
            Keep pending
          </Button>
          <form method="POST" action="/api/account/cancel">
            <Button
              type="submit"
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
            >
              Confirm cancel
            </Button>
          </form>
        </div>
      </dialog>
    </div>
  );
}
