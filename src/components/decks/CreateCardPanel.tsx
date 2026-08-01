import React, { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

const MAX_FIELD_LENGTH = 2000;

interface SessionCard {
  front: string;
  back: string;
}

interface Props {
  deckId: string;
}

export default function CreateCardPanel({ deckId }: Props) {
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sessionCards, setSessionCards] = useState<SessionCard[]>([]);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  function validate(): string | undefined {
    if (!front.trim()) return "Front text is required";
    if (front.length > MAX_FIELD_LENGTH) return `Front text must be ${MAX_FIELD_LENGTH} characters or fewer`;
    if (!back.trim()) return "Back text is required";
    if (back.length > MAX_FIELD_LENGTH) return `Back text must be ${MAX_FIELD_LENGTH} characters or fewer`;
    return undefined;
  }

  async function handleSubmit() {
    if (isSaving) return;

    const validationError = validate();
    if (validationError) {
      setFieldError(validationError);
      return;
    }

    setFieldError(undefined);
    setSaveError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/decks/${deckId}/cards/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front, back }),
      });

      const data = (await response.json()) as { card?: SessionCard; error?: string };

      if (!isMountedRef.current) return;

      if (!response.ok) {
        setSaveError(data.error ?? "Could not save the card");
        return;
      }

      if (data.card) {
        const card = data.card;
        setSessionCards((current) => [card, ...current]);
      }
      setFront("");
      setBack("");
      frontRef.current?.focus();
    } catch {
      if (!isMountedRef.current) return;
      setSaveError("Could not reach the server");
    } finally {
      if (isMountedRef.current) setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
        <label htmlFor="card-front" className="mb-1 block text-sm text-blue-100/80">
          Front
        </label>
        <textarea
          ref={frontRef}
          id="card-front"
          value={front}
          onChange={(e) => {
            setFront(e.target.value);
            if (fieldError) setFieldError(undefined);
          }}
          placeholder="Question or prompt..."
          rows={4}
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
        />

        <label htmlFor="card-back" className="mt-4 mb-1 block text-sm text-blue-100/80">
          Back
        </label>
        <textarea
          id="card-back"
          value={back}
          onChange={(e) => {
            setBack(e.target.value);
            if (fieldError) setFieldError(undefined);
          }}
          placeholder="Answer..."
          rows={4}
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
        />

        {fieldError && (
          <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
            <CircleAlert className="size-3" />
            {fieldError}
          </p>
        )}

        {saveError && (
          <p className="mt-2 flex items-center gap-1 text-sm text-red-300">
            <CircleAlert className="size-4 shrink-0" />
            {saveError}
          </p>
        )}

        <Button
          type="button"
          disabled={isSaving}
          onClick={handleSubmit}
          className="mt-4 w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
        >
          {isSaving ? "Adding..." : "Add card"}
        </Button>
      </div>

      <div>
        <h2 className="mb-3 text-sm text-blue-100/60">Cards added this session ({sessionCards.length})</h2>
        {sessionCards.length > 0 && (
          <ul className="space-y-3">
            {sessionCards.map((card, index) => (
              <li key={index} className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
                <p className="text-sm text-blue-100/60">Front</p>
                <p className="mb-3">{card.front}</p>
                <p className="text-sm text-blue-100/60">Back</p>
                <p>{card.back}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <a href="/decks" className="inline-block text-sm text-blue-200 transition hover:text-blue-100">
        ← Decks
      </a>
    </div>
  );
}
