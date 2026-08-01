import React, { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

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
      setEditingCardId(null);
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
    deleteDialogRef.current?.showModal();
  }

  function closeDeleteConfirm() {
    setPendingDelete(null);
    setDeleteError(null);
    deleteDialogRef.current?.close();
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

      const remainingOnPage = cards.filter((card) => card.id !== cardId).length;

      setPendingDelete(null);
      deleteDialogRef.current?.close();
      setCards((current) => current.filter((card) => card.id !== cardId));
      setTotal((current) => current - 1);
      if (remainingOnPage === 0 && page > 1) {
        setPage((current) => current - 1);
      }
    } catch {
      if (!isMountedRef.current) return;
      setDeleteError("Could not reach the server");
    } finally {
      if (isMountedRef.current) setIsDeleting(false);
    }
  }

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
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-300">
                      <CircleAlert className="size-3" />
                      {editFieldError}
                    </p>
                  )}

                  {editSaveError && (
                    <p className="mt-2 flex items-center gap-1 text-sm text-red-300">
                      <CircleAlert className="size-4 shrink-0" />
                      {editSaveError}
                    </p>
                  )}

                  <div className="mt-4 flex gap-2">
                    <Button
                      type="button"
                      disabled={isSavingEdit}
                      onClick={() => void saveEdit(card.id)}
                      className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-500"
                    >
                      {isSavingEdit ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      type="button"
                      disabled={isSavingEdit}
                      onClick={cancelEdit}
                      className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
                    >
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
                      onClick={() => {
                        startEdit(card);
                      }}
                      className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        openDeleteConfirm(card);
                      }}
                      className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-white/20"
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

      <dialog
        ref={deleteDialogRef}
        onCancel={() => {
          setPendingDelete(null);
          setDeleteError(null);
        }}
        onClick={(e) => {
          if (e.target === deleteDialogRef.current) {
            closeDeleteConfirm();
          }
        }}
        className="fixed top-1/2 left-1/2 m-0 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-900/95 p-6 text-white backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <p className="mb-6 text-blue-100/80">
          Delete card <span className="font-semibold text-white">&quot;{pendingDelete?.front}&quot;</span>? This cannot
          be undone.
        </p>

        {deleteError && (
          <p className="mb-4 flex items-center gap-1 text-sm text-red-300">
            <CircleAlert className="size-4 shrink-0" />
            {deleteError}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            disabled={isDeleting}
            onClick={closeDeleteConfirm}
            className="rounded-lg px-4 py-2 text-sm text-blue-100/80 transition hover:text-white"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isDeleting}
            onClick={() => void confirmDelete()}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </dialog>
    </div>
  );
}
