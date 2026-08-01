import React, { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

const PAGE_SIZE = 25;

interface Card {
  id: string;
  front: string;
  back: string;
  source: string;
  created_at: string;
}

interface Props {
  deckId: string;
}

export default function CardListPanel({ deckId }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

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

      try {
        const response = await fetch(`/api/decks/${deckId}/cards?page=${page}&pageSize=${PAGE_SIZE}`);
        const data = (await response.json()) as { cards?: Card[]; total?: number; error?: string };

        if (cancelled || !isMountedRef.current) return;

        if (!response.ok) {
          setLoadError(data.error ?? "Could not load cards");
          return;
        }

        setCards(data.cards ?? []);
        setTotal(data.total ?? 0);
      } catch {
        if (cancelled || !isMountedRef.current) return;
        setLoadError("Could not reach the server");
      } finally {
        if (!cancelled && isMountedRef.current) setIsLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [deckId, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      {isLoading && <p className="text-blue-100/60">Loading cards...</p>}

      {loadError && (
        <p className="flex items-center gap-1 text-sm text-red-300">
          <CircleAlert className="size-4 shrink-0" />
          {loadError}
        </p>
      )}

      {!isLoading && !loadError && total === 0 && (
        <p className="text-center text-blue-100/60">This deck doesn&apos;t have any cards yet.</p>
      )}

      {!isLoading && !loadError && total > 0 && (
        <>
          <ul className="space-y-3">
            {cards.map((card) => (
              <li key={card.id} className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
                <p className="text-sm text-blue-100/60">Front</p>
                <p className="mb-3 whitespace-pre-wrap">{card.front}</p>
                <p className="text-sm text-blue-100/60">Back</p>
                <p className="whitespace-pre-wrap">{card.back}</p>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between">
            <Button
              type="button"
              disabled={page <= 1}
              onClick={() => {
                setPage((current) => current - 1);
              }}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
            >
              Prev
            </Button>
            <span className="text-sm text-blue-100/60">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              disabled={page >= totalPages}
              onClick={() => {
                setPage((current) => current + 1);
              }}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-40"
            >
              Next
            </Button>
          </div>
        </>
      )}

      <a href="/decks" className="inline-block text-sm text-blue-200 transition hover:text-blue-100">
        ← Decks
      </a>
    </div>
  );
}
