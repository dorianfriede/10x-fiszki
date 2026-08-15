// risk: test-plan.md #5 — AI generation flow hangs or fails without a clear signal to the user
// seed: tests/e2e/seed.spec.ts
// scope: rendered-UI facet only (does the button ever stop spinning and show a bounded error).
// The server-side timeout/retry contract is covered at the integration layer per test-plan.md §2.
import { test, expect } from "@playwright/test";

test("a failed AI generation call surfaces a bounded error and lets the user retry, instead of hanging", async ({
  page,
}) => {
  const deckName = `E2E Gen Fail ${Date.now()}`;

  // Setup: create a fresh deck and open its generate page
  await page.goto("/decks");
  await page.getByRole("textbox", { name: "Deck name" }).fill(deckName);
  await page.getByRole("button", { name: "Create deck" }).click();
  const deckRow = page.getByRole("listitem").filter({ hasText: deckName });
  await expect(deckRow).toBeVisible();
  await deckRow.getByRole("link", { name: "Generate cards" }).click();
  await expect(page).toHaveURL(/\/decks\/.+\/generate/);

  // Mock the upstream-dependent route at the network edge: simulate a slow, failing
  // AI call without depending on the real (non-deterministic, costly) OpenRouter API.
  await page.route("**/api/decks/*/generate", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "The AI service returned an error" }),
    });
  });

  // React hydrates this island shortly after mount; a fill() that lands before hydration commits
  // gets silently reset by the controlled <textarea> re-render, and the click that follows fires
  // against an empty field (the app then — correctly — shows its own "paste some text first"
  // validation instead of calling the API). Neither the button's visible nor enabled state changes
  // across that transition, so the only reliable signal that hydration + the fill both landed is
  // the network request itself: retry the pair as a unit until the mocked request is observed.
  const generateButton = page.getByRole("button", { name: "Generate" });
  await expect(async () => {
    await page.getByLabel("Paste study text").fill("Some study notes for the flashcard generator to process.");
    // Set up the request listener before clicking — the request can fire as soon as the click
    // handler runs, and a listener attached after click() may already have missed the event.
    const requestPromise = page.waitForRequest("**/api/decks/*/generate", { timeout: 1000 });
    await generateButton.click();
    await requestPromise;
  }).toPass({ timeout: 15000 });

  // While the mocked call is in flight, the button must show it's busy, not silently do nothing
  await expect(page.getByRole("button", { name: "Generating..." })).toBeDisabled();

  // Once the failure response lands, the user must see a bounded error and a way to retry —
  // never stay stuck on the busy state (that's the "hangs" half of the risk).
  await expect(page.getByText("The AI service returned an error")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate" })).toBeEnabled();

  // Cleanup
  await page.unroute("**/api/decks/*/generate");
  await page.goto("/decks");
  await page.getByRole("listitem").filter({ hasText: deckName }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: deckName })).not.toBeVisible();
});
