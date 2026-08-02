import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  serverError?: string | null;
}

export default function CancelDeletionDialog({ serverError }: Props) {
  const [isOpen, setIsOpen] = useState(() => !!serverError);

  return (
    <div>
      <Button
        type="button"
        className="w-full"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Cancel deletion
      </Button>

      <form method="POST" action="/api/account/cancel">
        <ConfirmDialog
          open={isOpen}
          description={
            <>
              <p>Cancel your account deletion request and restore full access?</p>
              {serverError && (
                <div className="mt-3">
                  <ServerError message={serverError} />
                </div>
              )}
            </>
          }
          confirmLabel="Confirm cancel"
          cancelLabel="Keep pending"
          onCancel={() => {
            setIsOpen(false);
          }}
        />
      </form>
    </div>
  );
}
