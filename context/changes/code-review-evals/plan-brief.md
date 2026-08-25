# Promptfoo Eval Configuration for `tools/code-reviewer` — Plan Brief

> Full plan: `context/changes/code-review-evals/plan.md`
> Research: `context/changes/code-review-evals/research.md`

## What & Why

Introduce a first promptfoo eval configuration for `tools/code-reviewer`, running the existing review prompt against 3 OpenRouter models on one deliberately-flawed React 16→19 migration diff, with an LLM judge verifying whether each review correctly identifies the 3 injected flaws, plus a deterministic check that the review actually fails the diff.

## Starting Point

`tools/code-reviewer` is a 3-file, ~150-line CLI with no tests and no CI wiring. Its `ToolLoopAgent` is constructed inline inside `index.ts`'s `main()`, so it can't be imported by anything else — the blocking prerequisite for any eval tool, not just promptfoo.

## Desired End State

`npm run eval:code-reviewer` runs `promptfoo eval` and produces a report comparing all 3 models' reviews of the same fixture: a deterministic assertion confirms each returns `verdict: 'fail'`, and an independent judge model confirms each review's summary names all 3 injected flaws. The CLI's existing manual usage is unchanged.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Eval tool | promptfoo | Explicitly requested — wanted its multi-provider comparison, overriding the research doc's lower-friction `autoevals`/`vitest-evals` suggestion. | Plan |
| 3rd model under test | Existing default (`nvidia/nemotron-3-super-120b-a12b:free`) | User named only 2 models; reusing the already-wired free default needs zero new accounts. | Plan |
| Judge model | `anthropic/claude-sonnet-5`, via promptfoo's native `openrouter:` provider | Independent 4th model avoids self-grading bias; using promptfoo's built-in OpenRouter type for the *judge only* is safe since it isn't the code under test. | Plan |
| CI scope | Local-only npm script, no CI gate | Matches "create first configuration" framing; defers the unresolved run-cadence/cost question research flagged. | Plan |
| Rubric granularity | 3 separate `llm-rubric` assertions, one per flaw | Matches "verify whether results correctly identify what is broken" precisely — tells you exactly which flaw type a model misses. | Plan |
| Static check scope | `output.verdict === 'fail'` only, no per-dimension thresholds | Simplest; avoids coupling to dimension names while the rubric is still being actively hand-tuned. | Plan |
| Repeats | Single run per model, no repeat/majority-vote | Keeps this first configuration minimal; a stability upgrade can follow later. | Plan |

## Scope

**In scope:**
- Extracting `reviewDiff(diff, model?)` out of `index.ts` into `agent.ts`
- One fixture diff (React 16→19 `UserSearchForm` migration, 3 injected flaws)
- A promptfoo custom provider wrapping `reviewDiff`, parameterized by model
- `promptfooconfig.yaml` wiring 3 providers + 1 test case + deterministic and judge assertions
- An `npm run eval:code-reviewer` script and the `promptfoo` devDependency

**Out of scope:**
- CI wiring, cost/tokenUsage surfacing, repeat/majority-vote stability, per-dimension threshold assertions, a broader fixture set, rubric single-sourcing, README/CI-workflow edits

## Architecture / Approach

`agent.ts` becomes the single importable entry point for running a review, used by both the CLI (`index.ts`, unchanged behavior) and a new promptfoo `ApiProvider` adapter (`eval/promptfoo-provider.ts`). Three `providers:` entries in the promptfoo config point at that same adapter file with different `config.model` values, all fed the same fixture diff; a `javascript` assertion checks the deterministic verdict, and 3 `llm-rubric` assertions (graded by an independent judge model via `transform: output.summary`) check flaw-detection.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract importable agent | `agent.ts` with `reviewDiff(diff, model?)`; `index.ts` becomes a thin CLI wrapper | Must preserve exact CLI error-message/exit-code behavior |
| 2. Fixture + provider | Flawed React migration diff (3 flaws) + `ApiProvider` adapter | Flaws must be realistic and independently identifiable — technically grounded in verified React 19 breaking changes |
| 3. Wire the config | `promptfooconfig.yaml`, npm script, `promptfoo` devDependency | Real API cost per run (4 models); judge rationale needs a human spot-check |

**Prerequisites:** `OPENROUTER_API_KEY` already configured (existing `.env` pattern); no new accounts needed.
**Estimated effort:** ~1 session across 3 phases — small, self-contained tool.

## Open Risks & Assumptions

- promptfoo's `file://` loader for `.ts` custom providers works without extra `NODE_OPTIONS`/`tsx` install, per Context7 docs for the currently-published version — worth confirming during Phase 2/3 implementation in case the installed version differs.
- The LLM judge (`anthropic/claude-sonnet-5`) could itself misjudge a review's summary; Phase 3's manual verification step exists specifically to catch that.
- Real, non-free-tier API costs apply on every manual run (`z-ai/glm-5.1` + the judge model are not free-tier).

## Success Criteria (Summary)

- `npm run eval:code-reviewer` exits 0 and produces a report comparing all 3 models on the fixture
- The deterministic assertion and all 3 flaw-detection judge assertions pass for at least the strongest of the 3 models under test
- The existing CLI usage (`git diff | npx tsx tools/code-reviewer/index.ts`) is unaffected
