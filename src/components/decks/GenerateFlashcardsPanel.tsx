import React, { useState } from "react";
import { Sparkles, CircleAlert, RefreshCw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_TEXT_LENGTH = 10_000;

interface Proposal {
  front: string;
  back: string;
  decision: "accepted" | "rejected" | null;
}

interface SaveResult {
  saved: { front: string; back: string }[];
  totalCardCount: number;
}

interface Props {
  deckId: string;
}

export default function GenerateFlashcardsPanel({ deckId }: Props) {
  const [text, setText] = useState("");
  const [lengthError, setLengthError] = useState<string | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);

  async function handleGenerate() {
    const trimmed = text.trim();

    if (!trimmed) {
      setLengthError("Paste some text first");
      return;
    }

    if (text.length > MAX_TEXT_LENGTH) {
      setLengthError(`Text must be ${MAX_TEXT_LENGTH} characters or fewer`);
      return;
    }

    setLengthError(undefined);
    setGenerationError(null);
    setSaveResult(null);
    setIsGenerating(true);

    try {
      const response = await fetch(`/api/decks/${deckId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = (await response.json()) as { proposals?: { front: string; back: string }[]; error?: string };

      if (!response.ok) {
        setGenerationError(data.error ?? "The AI service returned an error");
        setProposals(null);
        return;
      }

      setProposals((data.proposals ?? []).map((proposal) => ({ ...proposal, decision: null })));
    } catch {
      setGenerationError("Could not reach the server");
      setProposals(null);
    } finally {
      setIsGenerating(false);
    }
  }

  function setDecision(index: number, decision: "accepted" | "rejected") {
    setProposals(
      (current) =>
        current?.map((proposal, i) =>
          i === index ? { ...proposal, decision: proposal.decision === decision ? null : decision } : proposal,
        ) ?? null,
    );
  }

  const acceptedProposals = proposals?.filter((proposal) => proposal.decision === "accepted") ?? [];

  async function handleSave() {
    if (acceptedProposals.length === 0) return;

    setSaveError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/decks/${deckId}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: acceptedProposals.map(({ front, back }) => ({ front, back })),
        }),
      });

      const data = (await response.json()) as Partial<SaveResult> & { error?: string };

      if (!response.ok) {
        setSaveError(data.error ?? "Could not save the cards");
        return;
      }

      setSaveResult({ saved: data.saved ?? [], totalCardCount: data.totalCardCount ?? 0 });
      setProposals(null);
    } catch {
      setSaveError("Could not reach the server");
    } finally {
      setIsSaving(false);
    }
  }

  if (saveResult) {
    return (
      <div className="space-y-6">
        <div className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
          <h2 className="text-xl font-semibold text-white">Saved {saveResult.saved.length} cards to this deck</h2>
          <p className="mt-1 text-sm text-blue-100/60">This deck now has {saveResult.totalCardCount} cards total.</p>
        </div>

        <ul className="space-y-3">
          {saveResult.saved.map((card, index) => (
            <li key={index} className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
              <p className="text-sm text-blue-100/60">Front</p>
              <p className="mb-3">{card.front}</p>
              <p className="text-sm text-blue-100/60">Back</p>
              <p>{card.back}</p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
        <label htmlFor="source-text" className="mb-1 block text-sm text-blue-100/80">
          Paste study text
        </label>
        <textarea
          id="source-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (lengthError) setLengthError(undefined);
          }}
          placeholder="Paste up to 10,000 characters of text to turn into flashcards..."
          rows={10}
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
        />
        {lengthError && (
          <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
            <CircleAlert className="size-3" />
            {lengthError}
          </p>
        )}

        <Button
          type="button"
          disabled={isGenerating}
          onClick={handleGenerate}
          className="mt-4 w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
        >
          {isGenerating ? (
            <span className="flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Generating...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Generate
            </span>
          )}
        </Button>
      </div>

      {generationError && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-red-500/30 bg-red-900/30 px-4 py-3 text-sm text-red-300">
          <span className="flex items-center gap-2">
            <CircleAlert className="size-4 shrink-0" />
            {generationError}
          </span>
          <Button
            type="button"
            onClick={handleGenerate}
            className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-white transition-colors hover:bg-white/20"
          >
            <RefreshCw className="size-4" />
            Try again
          </Button>
        </div>
      )}

      {proposals?.length === 0 && (
        <p className="text-center text-blue-100/60">
          No flashcards could be generated from that text — try adding more detail.
        </p>
      )}

      {proposals && proposals.length > 0 && (
        <>
          <ul className="space-y-3">
            {proposals.map((proposal, index) => (
              <li key={index} className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
                <p className="text-sm text-blue-100/60">Front</p>
                <p className="mb-3">{proposal.front}</p>
                <p className="text-sm text-blue-100/60">Back</p>
                <p className="mb-4">{proposal.back}</p>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      setDecision(index, "accepted");
                    }}
                    className={cn(
                      "rounded-lg px-3 py-1.5 transition-colors",
                      proposal.decision === "accepted"
                        ? "bg-emerald-600 text-white hover:bg-emerald-500"
                        : "bg-white/10 text-white hover:bg-white/20",
                    )}
                  >
                    <Check className="size-4" />
                    Accept
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setDecision(index, "rejected");
                    }}
                    className={cn(
                      "rounded-lg px-3 py-1.5 transition-colors",
                      proposal.decision === "rejected"
                        ? "bg-red-600 text-white hover:bg-red-500"
                        : "bg-white/10 text-white hover:bg-white/20",
                    )}
                  >
                    <X className="size-4" />
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {saveError && (
            <p className="flex items-center gap-1 text-sm text-red-300">
              <CircleAlert className="size-4 shrink-0" />
              {saveError}
            </p>
          )}

          <Button
            type="button"
            disabled={acceptedProposals.length === 0 || isSaving}
            onClick={handleSave}
            className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
          >
            {isSaving
              ? "Saving..."
              : `Save ${acceptedProposals.length} card${acceptedProposals.length === 1 ? "" : "s"}`}
          </Button>
        </>
      )}
    </div>
  );
}
