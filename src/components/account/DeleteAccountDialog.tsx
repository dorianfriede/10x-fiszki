import React, { useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/auth/FormField";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  email: string;
  serverError?: string | null;
}

export default function DeleteAccountDialog({ email, serverError }: Props) {
  const [isOpen, setIsOpen] = useState(() => !!serverError);
  const [confirmText, setConfirmText] = useState("");
  const canDelete = confirmText === email;

  function openDialog() {
    setConfirmText("");
    setIsOpen(true);
  }

  return (
    <div>
      <Button type="button" variant="ghost" className="border border-red-500/40 text-red-300" onClick={openDialog}>
        Delete account
      </Button>

      <form method="POST" action="/api/account/delete">
        <ConfirmDialog
          open={isOpen}
          description={
            <>
              <p className="mb-4">
                This permanently deletes your account and all your decks and cards after a 30-day window. Type{" "}
                <span className="font-semibold text-white">{email}</span> to confirm.
              </p>

              <FormField
                id="confirm-email"
                name="confirmEmail"
                label="Email"
                value={confirmText}
                onChange={setConfirmText}
                placeholder={email}
                icon={<Mail className="size-4" />}
              />

              {serverError && (
                <div className="mt-3">
                  <ServerError message={serverError} />
                </div>
              )}
            </>
          }
          confirmLabel="Delete my account"
          cancelLabel="Cancel"
          danger
          confirmDisabled={!canDelete}
          onCancel={() => {
            setIsOpen(false);
          }}
        />
      </form>
    </div>
  );
}
