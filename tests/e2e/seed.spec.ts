// seed.spec.ts
import { test, expect } from "@playwright/test";

test("Deck creation and deletion", async ({ page }) => {
  const deckName = `Test Deck ${Date.now()}`;
  await page.goto("/decks");

  await page.getByRole("textbox", { name: "Deck name" }).fill(deckName);
  await page.getByRole("button", { name: "Create deck" }).click();

  await expect(page.getByRole("listitem").filter({ hasText: deckName })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: deckName })).toBeVisible();

  // Cleanup
  await page.getByRole("listitem").filter({ hasText: deckName }).getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: deckName })).not.toBeVisible();
});
