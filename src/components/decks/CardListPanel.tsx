import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LoadingState } from "@/components/ui/loading-state";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineError } from "@/components/ui/inline-error";

const PAGE_SIZE = 25;
const MAX_FIELD_LENGTH = 2000;

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
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editFieldError, setEditFieldError] = useState<string | undefined>();
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Card | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
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

  // Pages back once the *current render's* card list for this page is
  // genuinely empty - adjusting state during render (React's documented
  // alternative to a "sync on change" Effect) means this reads `cards`,
  // `total`, and `page` as they exist in this commit, never a snapshot
  // closed over before an in-flight delete's fetch resolves, so navigating
  // away from the page mid-delete can't make it fire on stale data.
  const [cardsLengthAtLastCheck, setCardsLengthAtLastCheck] = useState(cards.length);
  if (cards.length !== cardsLengthAtLastCheck) {
    setCardsLengthAtLastCheck(cards.length);
    if (cards.length === 0 && total > 0 && page > 1) {
      setPage((current) => current - 1);
    }
  }

  function startEdit(card: Card) {
    setEditingCardId(card.id);
    setEditFront(card.front);
    setEditBack(card.back);
    setEditFieldError(undefined);
    setEditSaveError(null);
  }

  function cancelEdit() {
    setEditingCardId(null);
    setEditFieldError(undefined);
    setEditSaveError(null);
  }

  function validateEdit(): string | undefined {
    if (!editFront.trim()) return "Front text is required";
    if (editFront.length > MAX_FIELD_LENGTH) return `Front text must be ${MAX_FIELD_LENGTH} characters or fewer`;
    if (!editBack.trim()) return "Back text is required";
    if (editBack.length > MAX_FIELD_LENGTH) return `Back text must be ${MAX_FIELD_LENGTH} characters or fewer`;
    return undefined;
  }

  async function saveEdit(cardId: string) {
    if (isSavingEdit) return;

    const validationError = validateEdit();
    if (validationError) {
      setEditFieldError(validationError);
      return;
    }

    setEditFieldError(undefined);
    setEditSaveError(null);
    setIsSavingEdit(true);

    try {
      const response = await fetch(`/api/decks/${deckId}/cards/${cardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ front: editFront, back: editBack }),
      });

      const data = (await response.json()) as { card?: Card; error?: string };

      if (!isMountedRef.current) return;

      if (!response.ok) {
        setEditSaveError(data.error ?? "Could not save the card");
        return;
      }

      if (data.card) {
        const updated = data.card;
        setCards((current) => current.map((card) => (card.id === updated.id ? updated : card)));
      }
      setEditingCardId((current) => (current === cardId ? null : current));
    } catch {
      if (!isMountedRef.current) return;
      setEditSaveError("Could not reach the server");
    } finally {
      if (isMountedRef.current) setIsSavingEdit(false);
    }
  }

  function openDeleteConfirm(card: Card) {
    setPendingDelete(card);
    setDeleteError(null);
  }

  function closeDeleteConfirm() {
    setPendingDelete(null);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!pendingDelete || isDeleting) return;

    const cardId = pendingDelete.id;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/decks/${deckId}/cards/${cardId}`, { method: "DELETE" });

      if (!isMountedRef.current) return;

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setDeleteError(data.error ?? "Could not delete the card");
        return;
      }

      setPendingDelete(null);
      setCards((current) => current.filter((card) => card.id !== cardId));
      setTotal((current) => current - 1);
    } catch {
      if (!isMountedRef.current) return;
      setDeleteError("Could not reach the server");
    } finally {
      if (isMountedRef.current) setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      {isLoading && <LoadingState label="Loading cards..." />}

      {loadError && <InlineError message={loadError} />}

      {!isLoading && !loadError && total === 0 && <EmptyState>This deck doesn&apos;t have any cards yet.</EmptyState>}

      {!isLoading && !loadError && total > 0 && (
        <>
          <ul className="space-y-3">
            {cards.map((card) =>
              editingCardId === card.id ? (
                <li key={card.id} className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
                  <label htmlFor={`edit-front-${card.id}`} className="mb-1 block text-sm text-blue-100/60">
                    Front
                  </label>
                  <textarea
                    id={`edit-front-${card.id}`}
                    value={editFront}
                    onChange={(e) => {
                      setEditFront(e.target.value);
                      if (editFieldError) setEditFieldError(undefined);
                    }}
                    rows={4}
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
                  />

                  <label htmlFor={`edit-back-${card.id}`} className="mt-4 mb-1 block text-sm text-blue-100/60">
                    Back
                  </label>
                  <textarea
                    id={`edit-back-${card.id}`}
                    value={editBack}
                    onChange={(e) => {
                      setEditBack(e.target.value);
                      if (editFieldError) setEditFieldError(undefined);
                    }}
                    rows={4}
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
                  />

                  {editFieldError && (
                    <div className="mt-1">
                      <InlineError message={editFieldError} size="xs" />
                    </div>
                  )}

                  {editSaveError && (
                    <div className="mt-2">
                      <InlineError message={editSaveError} />
                    </div>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Button type="button" disabled={isSavingEdit} onClick={() => void saveEdit(card.id)}>
                      {isSavingEdit ? "Saving..." : "Save"}
                    </Button>
                    <Button type="button" variant="secondary" disabled={isSavingEdit} onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                </li>
              ) : (
                <li key={card.id} className="rounded-xl border border-white/10 bg-white/5 p-4 text-white">
                  <p className="text-sm text-blue-100/60">Front</p>
                  <p className="mb-3 whitespace-pre-wrap">{card.front}</p>
                  <p className="text-sm text-blue-100/60">Back</p>
                  <p className="whitespace-pre-wrap">{card.back}</p>

                  <div className="mt-4 flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        startEdit(card);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-red-300"
                      onClick={() => {
                        openDeleteConfirm(card);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => {
                setPage((current) => current - 1);
              }}
            >
              Prev
            </Button>
            <span className="text-sm text-blue-100/60">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => {
                setPage((current) => current + 1);
              }}
            >
              Next
            </Button>
          </div>
        </>
      )}

      <a href="/decks" className="inline-block text-sm text-blue-200 transition hover:text-blue-100">
        ← Decks
      </a>

      <ConfirmDialog
        open={pendingDelete !== null}
        description={
          <>
            Delete card <span className="font-semibold text-white">&quot;{pendingDelete?.front}&quot;</span>? This
            cannot be undone.
          </>
        }
        confirmLabel={isDeleting ? "Deleting..." : "Delete"}
        cancelLabel="Cancel"
        danger
        isPending={isDeleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={closeDeleteConfirm}
      />
    </div>
  );
}
