import { afterEach, describe, expect, it, vi } from "vitest";
import { fsrs, generatorParameters, State } from "ts-fsrs";
import { scheduler, toFsrsCard, type FsrsFields } from "@/lib/fsrs";

const now = new Date("2026-01-01T00:00:00.000Z");

// Mirrors the `cards` table's DB defaults for a never-reviewed row
// (supabase/migrations/20260801130000_cards_fsrs_fields.sql), not a
// library-side fixture — the oracle is "what a brand-new card looks like
// in this app's schema," not "whatever createEmptyCard() happens to return."
const newCardRow: FsrsFields = {
  due: now.toISOString(),
  stability: 0,
  difficulty: 0,
  elapsed_days: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  state: 0,
  last_review: null,
};

describe("fsrs scheduler config (enable_short_term: false)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([1, 2, 3, 4])("grade %i transitions a brand-new card straight to day-scale Review state", (grade) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const card = toFsrsCard(newCardRow);
    const { card: next } = scheduler.next(card, now, grade);

    expect(next.state).toBe(State.Review);
    expect(next.scheduled_days).toBeGreaterThanOrEqual(1);
  });

  it("differs from ts-fsrs's own default (enable_short_term: true), proving the override is a real effect and not a fixture coincidence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const defaultScheduler = fsrs(generatorParameters({ enable_short_term: true }));
    const card = toFsrsCard(newCardRow);

    for (const grade of [1, 2, 3] as const) {
      const { card: next } = defaultScheduler.next(card, now, grade);
      expect(next.state).toBe(State.Learning);
      expect(next.reps).toBe(1);
    }

    const { card: easyNext } = defaultScheduler.next(card, now, 4);
    expect(easyNext.reps).toBe(1);
  });
});
