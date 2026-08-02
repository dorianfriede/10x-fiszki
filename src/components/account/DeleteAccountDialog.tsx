import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  email: string;
  serverError?: string | null;
}

export default function DeleteAccountDialog({ email, serverError }: Props) {
  const [confirmText, setConfirmText] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canDelete = confirmText === email;

  useEffect(() => {
    if (serverError) {
      dialogRef.current?.showModal();
    }
  }, [serverError]);

  function openDialog() {
    setConfirmText("");
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
        className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-white/20"
      >
        Delete account
      </Button>

      <dialog
        ref={dialogRef}
        onCancel={closeDialog}
        onClick={(e) => {
          if (e.target === dialogRef.current) closeDialog();
        }}
        className="fixed top-1/2 left-1/2 m-0 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-900/95 p-6 text-white backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <p className="mb-4 text-blue-100/80">
          This permanently deletes your account and all your decks and cards after a 30-day window. Type{" "}
          <span className="font-semibold text-white">{email}</span> to confirm.
        </p>

        <form method="POST" action="/api/account/delete" className="space-y-4">
          <div>
            <label htmlFor="confirm-email" className="mb-1 block text-sm text-blue-100/80">
              Email
            </label>
            <input
              id="confirm-email"
              type="text"
              value={confirmText}
              onChange={(e) => {
                setConfirmText(e.target.value);
              }}
              placeholder={email}
              autoComplete="off"
              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
            />
          </div>

          <ServerError message={serverError} />

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              onClick={closeDialog}
              className="rounded-lg px-4 py-2 text-sm text-blue-100/80 transition hover:text-white"
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!canDelete}>
              Delete my account
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
