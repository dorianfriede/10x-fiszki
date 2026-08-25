---
change_id: code-review-evals
title: Introduce eval coverage for tools/code-reviewer
status: implementing
created: 2026-08-25
updated: 2026-08-25
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 3 deviation: forced to free-tier-only models; eval ships as a documented-failing baseline (2026-08-25)

**Why the plan's models couldn't be used.** Plan's Phase 3 contract specified `z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`, and `anthropic/claude-sonnet-5` (judge) — all paid. The user's `OPENROUTER_API_KEY` has an intentional $0.00 total spend limit; every paid-model call 403'd with "Key limit exceeded (total limit)", while `nvidia/nemotron-3-super-120b-a12b:free` succeeded, confirming the key works fine for `:free` models — the fix had to be free-tier-only, not a higher limit.

**First substitution attempt failed too.** Live-verified against `https://openrouter.ai/api/v1/models` that none of `z-ai/glm-5.1:free`, `deepseek/deepseek-v4-flash:free`, or `qwen/qwen3-next-80b-a3b-instruct:free` exist. The user's first-choice replacements (`z-ai/glm-5.2:free`, `minimax/minimax-m3:free`, judge `google/gemma-4-31b-it:free`) were then tested directly against the real `reviewDiff` code path, one at a time (not via promptfoo, to isolate real capability from eval-level concurrency noise). Results: `glm-5.2:free` and `gemma-4-31b-it:free`/`gemma-4-26b-a4b-it:free` are persistently rate-limited upstream on every attempt (shared free-tier quota, not fixable from our side); `minimax/minimax-m3:free` and `minimax/minimax-m2.7:free` reliably fail to produce valid structured/tool-call output (`AI_NoObjectGeneratedError`). Also ruled out: `cohere/north-mini-code:free`, `poolside/laguna-s-2.1:free` (same parse failure), `thinkingmachines/inkling:free` (refuses standalone API use), `liquid/lfm-2.5-2.6b:free` (model unavailable for inference).

**Final model pool — confirmed working in isolation:**
- Providers under test: `nvidia/nemotron-3-super-120b-a12b:free` (unchanged default), `nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` (user's pick, all NVIDIA — only reliable family found)
- Judge: `dots-studio/dots-3-note-preview:free` (the only confirmed-working non-NVIDIA free model; kept over the `nvidia/nemotron-3.5-lightning:free` fallback because it was the *more* reliable of the two at producing valid JSON for promptfoo's `llm-rubric` grading — 2/6 vs 5/6 grading calls failed to parse)

**This eval currently fails, by design/environment, not by bug.** `npm run eval:code-reviewer` exits 100 (promptfoo's real failure exit code — confirmed directly, not masked by a `| tail` pipe). Two independent causes, verified across repeated runs:
1. None of the 3 free reviewer models under test mention the `defaultProps` or `propTypes` flaws in their summary — only the skipped-test flaw (#3) is ever caught. This is a genuine model-capability gap with the currently-available free tier, not a config defect.
2. Free-tier judge models are unreliable at following promptfoo's JSON-based `llm-rubric` grading protocol — every candidate tested has a nontrivial parse-failure rate.

User decision: ship the config as-is — a mechanically-correct, honestly-failing baseline. `npm run eval:code-reviewer exits 0` (plan step 3.1) is intentionally left unchecked in `plan.md`'s Progress section; re-running this eval once paid models (or better free ones) become available is the natural way to re-validate. The plan's Phase 3 contract block was left as-authored (read-only) since it documents the original design intent.
