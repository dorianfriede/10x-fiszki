import React, { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { fsrs, generatorParameters, Rating, type Grade } from "ts-fsrs";
import { Button } from "@/components/ui/button";
import { toFsrsCard, type FsrsFields } from "@/lib/fsrs";
import type { Tables } from "@/db/database.types";

type ReviewCard = Pick<Tables<"cards">, "id" | "front" | "back"> & FsrsFields;

interface Props {
  deckId: string;
}

const RATING_BUTTONS: { grade: Grade; label: string; variant: "destructive" | "secondary" | "default" | "outline" }[] =
  [
    { grade: Rating.Again, label: "Again", variant: "destructive" },
    { grade: Rating.Hard, label: "Hard", variant: "secondary" },
    { grade: Rating.Good, label: "Good", variant: "default" },
    { grade: Rating.Easy, label: "Easy", variant: "outline" },
  ];

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

function formatInterval(due: Date, now: Date): string {
  const diffMs = due.getTime() - now.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return pluralize(Math.max(1, minutes), "min");
  const hours = Math.round(diffMs / 3_600_000);
  if (hours < 24) return pluralize(hours, "hour");
  const days = Math.round(diffMs / 86_400_000);
  if (days < 30) return pluralize(days, "day");
  const months = Math.round(days / 30);
  if (months < 12) return pluralize(months, "month");
  return pluralize(Math.round(days / 365), "year");
}

async function fetchDueCards(deckId: string): Promise<{ cards: ReviewCard[] } | { error: string }> {
  const response = await fetch(`/api/decks/${deckId}/review`);
  const data = (await response.json()) as { cards?: ReviewCard[]; error?: string };

  if (!response.ok) {
    return { error: data.error ?? "Could not load the review session" };
  }

  return { cards: data.cards ?? [] };
}

export default function ReviewSessionPanel({ deckId }: Props) {
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [preview, setPreview] = useState<Partial<Record<Grade, Date>> | null>(null);
  const [isRating, setIsRating] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [remainingDue, setRemainingDue] = useState<number | null>(null);
  const [ratedSnapshots, setRatedSnapshots] = useState<Map<string, FsrsFields>>(new Map());
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [partialResetMessage, setPartialResetMessage] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const localSchedulerRef = useRef(fsrs(generatorParameters({ enable_short_term: false })));
  const resetDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setLoadError(null);

      const result = await fetchDueCards(deckId);

      if (cancelled || !isMountedRef.current) return;

      if ("error" in result) {
        setLoadError(result.error);
      } else {
        setCards(result.cards);
        setCurrentIndex(0);
        setRevealed(false);
        setPreview(null);
        setRemainingDue(null);
      }
      setIsLoading(false);
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [deckId]);

  async function continueReviewing() {
    if (isLoading) return;
    setIsLoading(true);
    setLoadError(null);

    const result = await fetchDueCards(deckId);

    if (!isMountedRef.current) return;

    if ("error" in result) {
      setLoadError(result.error);
    } else {
      setCards(result.cards);
      setCurrentIndex(0);
      setRevealed(false);
      setPreview(null);
      setRemainingDue(null);
    }
    setIsLoading(false);
  }

  function reveal() {
    if (currentIndex >= cards.length) return;
    const currentCard = cards[currentIndex];

    const record = localSchedulerRef.current.repeat(toFsrsCard(currentCard), new Date());
    setPreview({
      [Rating.Again]: record[Rating.Again].card.due,
      [Rating.Hard]: record[Rating.Hard].card.due,
      [Rating.Good]: record[Rating.Good].card.due,
      [Rating.Easy]: record[Rating.Easy].card.due,
    });
    setRevealed(true);
  }

  async function rate(grade: Grade) {
    if (isRating || currentIndex >= cards.length) return;
    const currentCard = cards[currentIndex];

    setRatedSnapshots((current) => {
      if (current.has(currentCard.id)) return current;
      const next = new Map(current);
      next.set(currentCard.id, {
        due: currentCard.due,
        stability: currentCard.stability,
        difficulty: currentCard.difficulty,
        elapsed_days: currentCard.elapsed_days,
        scheduled_days: currentCard.scheduled_days,
        learning_steps: currentCard.learning_steps,
        reps: currentCard.reps,
        lapses: currentCard.lapses,
        state: currentCard.state,
        last_review: currentCard.last_review,
      });
      return next;
    });

    setIsRating(true);
    setRateError(null);

    try {
      const response = await fetch(`/api/decks/${deckId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: currentCard.id, grade }),
      });

      const data = (await response.json()) as { remainingDue?: number; error?: string };

      if (!isMountedRef.current) return;

      if (!response.ok) {
        setRateError(data.error ?? "Could not save this rating");
        return;
      }

      const isLastInBatch = currentIndex >= cards.length - 1;
      setRevealed(false);
      setPreview(null);

      if (isLastInBatch) {
        setRemainingDue(data.remainingDue ?? 0);
      } else {
        setCurrentIndex((i) => i + 1);
      }
    } catch {
      if (!isMountedRef.current) return;
      setRateError("Could not reach the server");
    } finally {
      if (isMountedRef.current) setIsRating(false);
    }
  }

  function openResetConfirm() {
    setResetError(null);
    resetDialogRef.current?.showModal();
  }

  function closeResetConfirm() {
    setResetError(null);
    resetDialogRef.current?.close();
  }

  async function confirmReset() {
    if (isResetting || ratedSnapshots.size === 0) return;

    setIsResetting(true);
    setResetError(null);

    try {
      const payload = Array.from(ratedSnapshots.entries()).map(([cardId, fields]) => ({ id: cardId, ...fields }));

      const response = await fetch(`/api/decks/${deckId}/review-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cards: payload }),
      });

      const data = (await response.json()) as { restored?: number; total?: number; error?: string };

      if (!isMountedRef.current) return;

      if (!response.ok) {
        setResetError(data.error ?? "Could not reset the session");
        return;
      }

      const restored = data.restored ?? 0;
      const total = data.total ?? payload.length;

      if (restored < total) {
        setPartialResetMessage(`${restored} of ${total} cards restored — click Reset session again to retry the rest`);
        return;
      }

      setPartialResetMessage(null);
      setRatedSnapshots(new Map());
      setRateError(null);
      resetDialogRef.current?.close();
      await continueReviewing();
    } catch {
      if (!isMountedRef.current) return;
      setResetError("Could not reach the server");
    } finally {
      if (isMountedRef.current) setIsResetting(false);
    }
  }

  const resetDialog = (
    <dialog
      ref={resetDialogRef}
      onCancel={() => {
        setResetError(null);
      }}
      onClick={(e) => {
        if (e.target === resetDialogRef.current) closeResetConfirm();
      }}
      className="fixed top-1/2 left-1/2 m-0 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-900/95 p-6 text-white backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      <p className="mb-6 text-blue-100/80">
        Undo {pluralize(ratedSnapshots.size, "rating")} from this session? Affected cards will return to their
        pre-rating due dates. This cannot be undone.
      </p>

      {partialResetMessage && (
        <p className="mb-4 flex items-center gap-1 text-sm text-amber-300">
          <CircleAlert className="size-4 shrink-0" />
          {partialResetMessage}
        </p>
      )}

      {resetError && (
        <p className="mb-4 flex items-center gap-1 text-sm text-red-300">
          <CircleAlert className="size-4 shrink-0" />
          {resetError}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          disabled={isResetting}
          onClick={closeResetConfirm}
          className="rounded-lg px-4 py-2 text-sm text-blue-100/80 transition hover:text-white"
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={isResetting}
          onClick={() => void confirmReset()}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
        >
          {isResetting ? "Resetting..." : "Reset session"}
        </Button>
      </div>
    </dialog>
  );

  if (isLoading) {
    return <p className="text-blue-100/60">Loading review session...</p>;
  }

  if (loadError) {
    return (
      <p className="flex items-center gap-1 text-sm text-red-300">
        <CircleAlert className="size-4 shrink-0" />
        {loadError}
      </p>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-center text-blue-100/60">No cards due for review right now.</p>
        <a href="/decks" className="inline-block text-sm text-blue-200 transition hover:text-blue-100">
          ← Decks
        </a>
      </div>
    );
  }

  if (remainingDue !== null) {
    if (remainingDue === 0) {
      return (
        <div className="space-y-4">
          <p className="text-center text-blue-100/60">Session complete.</p>
          <div className="flex justify-center gap-3">
            <a href="/decks" className="inline-block text-sm text-blue-200 transition hover:text-blue-100">
              ← Decks
            </a>
            {ratedSnapshots.size > 0 && (
              <Button
                type="button"
                onClick={openResetConfirm}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-white/20"
              >
                Reset session
              </Button>
            )}
          </div>
          {resetDialog}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <p className="text-center text-blue-100/60">
          Session complete — {remainingDue} more card{remainingDue === 1 ? "" : "s"} {remainingDue === 1 ? "is" : "are"}{" "}
          due.
        </p>
        <div className="flex justify-center gap-3">
          <a
            href="/decks"
            className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
          >
            Finish for now
          </a>
          <Button
            type="button"
            onClick={() => void continueReviewing()}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
          >
            Continue reviewing
          </Button>
          {ratedSnapshots.size > 0 && (
            <Button
              type="button"
              onClick={openResetConfirm}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-white/20"
            >
              Reset session
            </Button>
          )}
        </div>
        {resetDialog}
      </div>
    );
  }

  const currentCard = cards[currentIndex];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl">
        <p className="text-sm text-blue-100/60">Front</p>
        <p className="mb-4 whitespace-pre-wrap text-white">{currentCard.front}</p>

        {!revealed && (
          <Button
            type="button"
            onClick={reveal}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
          >
            Show answer
          </Button>
        )}

        {revealed && (
          <>
            <p className="text-sm text-blue-100/60">Back</p>
            <p className="mb-4 whitespace-pre-wrap text-white">{currentCard.back}</p>

            <div className="flex flex-wrap gap-2">
              {RATING_BUTTONS.map(({ grade, label, variant }) => (
                <Button
                  key={grade}
                  type="button"
                  variant={variant}
                  disabled={isRating}
                  onClick={() => void rate(grade)}
                  className="flex-1 rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {label}
                  {preview?.[grade] && (
                    <span className="ml-1 text-xs opacity-70">({formatInterval(preview[grade], new Date())})</span>
                  )}
                </Button>
              ))}
            </div>
          </>
        )}

        {rateError && (
          <p className="mt-3 flex items-center gap-1 text-sm text-red-300">
            <CircleAlert className="size-4 shrink-0" />
            {rateError}
          </p>
        )}

        {ratedSnapshots.size > 0 && (
          <Button
            type="button"
            disabled={isRating}
            onClick={openResetConfirm}
            className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-white/20"
          >
            Reset session
          </Button>
        )}
      </div>

      <p className="text-center text-xs text-blue-100/40">
        Card {currentIndex + 1} of {cards.length}
      </p>

      {resetDialog}
    </div>
  );
}
