// risk: test-plan.md #1 — Review session (FSRS) produces incorrect or inconsistent recall ratings / due-dates
// seed: tests/e2e/seed.spec.ts
// scope: rendered-UI + persistence facet only — does the FSRS-computed due date shown to the user
// (client preview) actually get persisted server-side and survive a real page reload, so a just-rated
// card never resurfaces in the same review session. The scheduler's transition math itself (given a
// rating, is the next state FSRS-correct) is covered at the unit layer (tests/unit/fsrs.test.ts) and the
// API round-trip is covered at the integration layer (tests/integration/review.test.ts) per test-plan.md
// §2 Risk Response Guidance — neither exercises the actual rendered island across a real SSR reload.
import { test, expect } from "@playwright/test";

test("a graded review card's FSRS-scheduled due date persists across a reload, so it never resurfaces in the same session", async ({
  page,
}) => {
  const deckName = `E2E FSRS Risk1 ${Date.now()}`;

  // Setup: create a fresh deck and add one card to it — a brand-new card is due immediately.
  await page.goto("/decks");
  await page.getByRole("textbox", { name: "Deck name" }).fill(deckName);
  await page.getByRole("button", { name: "Create deck" }).click();
  const deckRow = page.getByRole("listitem").filter({ hasText: deckName });
  await expect(deckRow).toBeVisible();

  await deckRow.getByRole("link", { name: "Add card" }).click();
  await expect(page).toHaveURL(/\/decks\/.+\/cards\/new/);
  // CreateCardPanel hydrates shortly after mount; a fill() that lands before hydration commits gets
  // silently reset by the controlled <textarea>, so the submit that follows fires against an empty
  // field (the app then — correctly — shows its own "text is required" validation instead of saving).
  // Retry the fill+submit pair as a unit until the card actually lands.
  await expect(async () => {
    await page.getByRole("textbox", { name: "Front" }).fill("What does FSRS stand for?");
    await page.getByRole("textbox", { name: "Back" }).fill("Free Spaced Repetition Scheduler");
    await page.getByRole("button", { name: "Add card" }).click();
    await expect(page.getByRole("heading", { name: "Cards added this session (1)" })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });

  // Action: open the review session, reveal the card, and rate it "Good".
  await page.goto("/decks");
  await deckRow.getByRole("link", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/decks\/.+\/review/);
  // The card's `due` defaults to the DB server's now() at insert time, compared against the app
  // server's own now() a moment later — a benign sub-second clock gap between the two processes can
  // occasionally leave it not-yet-due on the very first fetch. Reload (which re-triggers the fetch)
  // until it shows up, rather than waiting a fixed amount of time.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("What does FSRS stand for?")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 10000 });

  await page.getByRole("button", { name: "Show answer" }).click();
  await expect(page.getByText("Free Spaced Repetition Scheduler")).toBeVisible();
  // The preview label ("Good (3 days)") is itself the local-scheduler forecast the user sees before
  // rating — match by prefix so a rounding-driven interval-text change doesn't make this brittle.
  await page.getByRole("button", { name: /^Good/ }).click();
  await expect(page.getByText("Session complete.")).toBeVisible();

  // Verify: a real SSR reload re-queries due cards from scratch. If the server's FSRS scheduling
  // (src/pages/api/decks/[id]/review.ts) failed to compute or persist a future due date, this
  // just-rated card would still show up as due — the exact failure mode risk #1 names.
  await page.reload();
  await expect(page.getByText("No cards due for review right now.")).toBeVisible();

  // Cleanup
  await page.goto("/decks");
  await deckRow.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(deckRow).not.toBeVisible();
});
