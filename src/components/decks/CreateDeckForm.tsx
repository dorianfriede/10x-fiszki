import React, { useState } from "react";
import { FolderPlus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

const MAX_NAME_LENGTH = 100;

interface Props {
  serverError?: string | null;
}

export default function CreateDeckForm({ serverError }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();

  function validate() {
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Deck name is required");
      return false;
    }

    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(`Deck name must be ${MAX_NAME_LENGTH} characters or fewer`);
      return false;
    }

    setError(undefined);
    return true;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/decks" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="name"
        label="Deck name"
        value={name}
        onChange={(v) => {
          setName(v);
          if (error) setError(undefined);
        }}
        placeholder="e.g. Spanish Vocabulary"
        error={error}
        icon={<FolderPlus className="size-4" />}
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Creating deck..." icon={<FolderPlus className="size-4" />}>
        Create deck
      </SubmitButton>
    </form>
  );
}
