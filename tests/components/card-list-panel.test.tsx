// @vitest-environment jsdom
import { render, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CardListPanel from "@/components/decks/CardListPanel";

interface Card {
  id: string;
  front: string;
  back: string;
  source: string;
  created_at: string;
}

function makeCard(id: string, front: string, back: string): Card {
  return { id, front, back, source: "manual", created_at: "2026-01-01T00:00:00.000Z" };
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as Response;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function requestKey(input: RequestInfo | URL, init: RequestInit | undefined): string {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? "GET";
  return `${method} ${url}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CardListPanel edit-race regression", () => {
  it("does not clobber card B's edit UI when card A's earlier save resolves later", async () => {
    const cardA = makeCard("card-a", "front A", "back A");
    const cardB = makeCard("card-b", "front B", "back B");

    const patchADeferred = deferred<Response>();

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const key = requestKey(input, init);
      if (key === "GET /api/decks/deck-1/cards?page=1&pageSize=25") {
        return Promise.resolve(jsonResponse({ cards: [cardA, cardB], total: 2 }));
      }
      if (key === "PATCH /api/decks/deck-1/cards/card-a") {
        return patchADeferred.promise;
      }
      throw new Error(`Unexpected fetch call: ${key}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CardListPanel deckId="deck-1" />);

    await screen.findByText("front A");

    const rowA = screen.getByText("front A").closest("li");
    if (!rowA) throw new Error("expected card A's row to render");
    fireEvent.click(within(rowA).getByRole("button", { name: "Edit" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // saveEdit's fetch is now pending (patchADeferred not yet resolved).

    const rowB = screen.getByText("front B").closest("li");
    if (!rowB) throw new Error("expected card B's row to render");
    fireEvent.click(within(rowB).getByRole("button", { name: "Edit" }));

    // Card B's edit UI should be showing now, with card A back to its normal view.
    expect(screen.getByLabelText("Back")).toHaveValue("back B");

    patchADeferred.resolve(jsonResponse({ card: cardA }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // Card B's edit UI must still be showing - card A's late-resolving save
    // must not have cleared editingCardId out from under it.
    expect(screen.getByLabelText("Back")).toHaveValue("back B");
  });
});

describe("CardListPanel pagination-race fix", () => {
  it("does not page back based on a stale pre-navigation card snapshot", async () => {
    const page1Cards = [
      makeCard("p1-a", "page1 front a", "page1 back a"),
      makeCard("p1-b", "page1 front b", "page1 back b"),
    ];
    const page2Card = makeCard("p2-a", "page2 front a", "page2 back a");

    const deleteDeferred = deferred<Response>();

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const key = requestKey(input, init);
      if (key === "GET /api/decks/deck-1/cards?page=1&pageSize=25") {
        return Promise.resolve(jsonResponse({ cards: page1Cards, total: 27 }));
      }
      if (key === "GET /api/decks/deck-1/cards?page=2&pageSize=25") {
        return Promise.resolve(jsonResponse({ cards: [page2Card], total: 27 }));
      }
      if (key === "DELETE /api/decks/deck-1/cards/p2-a") {
        return deleteDeferred.promise;
      }
      throw new Error(`Unexpected fetch call: ${key}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CardListPanel deckId="deck-1" />);

    await screen.findByText("page1 front a");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("page2 front a");
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();

    const row = screen.getByText("page2 front a").closest("li");
    if (!row) throw new Error("expected page 2's card row to render");
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    // The DELETE fetch for p2-a is now pending (deleteDeferred not yet resolved).

    // Navigate back to page 1 while the delete is still in flight.
    fireEvent.click(screen.getByRole("button", { name: "Prev" }));
    await screen.findByText("page1 front a");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    deleteDeferred.resolve(jsonResponse(null));
    // The delete's success path clears pendingDelete, which closes the
    // dialog - wait on that rather than fetch call count, since the 4th
    // call (the Prev-triggered GET) already fired before the delete
    // resolved and would make a call-count wait vacuous.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // A buggy implementation would compute "0 cards remain" from the stale
    // pre-navigation page-2 snapshot and page back to 0. The fix must leave
    // the user on page 1, viewing page 1's own (untouched) cards.
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("page1 front a")).toBeInTheDocument();
    expect(screen.getByText("page1 front b")).toBeInTheDocument();
  });
});
