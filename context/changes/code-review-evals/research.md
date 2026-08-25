---
date: 2026-08-25T18:55:12+02:00
researcher: Dorian Friede
git_commit: 7fb417f8602c35608b39cd5c7c0b21fb0e5a1db6
branch: main
repository: dorianfriede/10x-fiszki
topic: "code-review-evals: eval-toolkit fit for tools/code-reviewer (promptfoo vs. alternatives)"
tags: [research, codebase, code-reviewer, evals, promptfoo, ai-sdk, vitest]
status: complete
last_updated: 2026-08-25
last_updated_by: Dorian Friede
---

# Research: Eval-toolkit fit for `tools/code-reviewer`

**Date**: 2026-08-25T18:55:12+02:00
**Researcher**: Dorian Friede
**Git Commit**: 7fb417f8602c35608b39cd5c7c0b21fb0e5a1db6
**Branch**: main
**Repository**: dorianfriede/10x-fiszki

## Research Question

Analyze the current state of `tools/code-reviewer` in the context of potential eval introduction — reusability of prompts, importability of agent, etc. First pick for eval toolkit is promptfoo; if the tech stack is aligned with it, go in that direction, otherwise analyze other OSS tools for evaluating prompts/agents. Use current docs (Context7 / web search), not memory.

## Summary

`tools/code-reviewer` is a 3-file, ~150-line CLI (`index.ts` + `schema.ts` + `prompt.ts`) built on the Vercel AI SDK (`ai` v7, `ToolLoopAgent`) with an OpenRouter provider and a zod-validated 5-dimension + verdict structured output. It is currently **not eval-ready**: the agent is constructed inline inside `main()` and isn't exported/importable, and the tool has zero automated tests or CI wiring. The prompt/schema pair is also **actively being hand-tuned right now** — an uncommitted working-tree diff reworks the rubric (splitting `idiomaticity`/`complexity` into `typeSafetyCompliance` + `conventionConsistency`, dropping `complexity`, renaming `securitySafety` → `securityDataAccessSafety`) with no way to measure whether the change improved or regressed review quality. This is precisely the gap a prior architectural audit (`context/architect-report.md`) and the team's opportunity-mapping session (`context/team/opportunity-map.md`) already flagged as the top unaddressed risk for this codebase's core AI behavior, independently recommending "a separate evaluation harness" rather than folding it into unrelated refactor work.

**Promptfoo does technically fit** the stack (Node 22, ESM, TypeScript) via its `file://` custom-provider mechanism, which can wrap the existing `ToolLoopAgent` in-process, and its `javascript`/`is-json` assertions can score the 5-dimension + verdict object without model-graded re-judging. CI gating (`promptfoo-action`, exit codes) and prompt reuse (`file://prompt.ts:SYSTEM_PROMPT`, or just importing `SYSTEM_PROMPT` inside the custom provider) both work cleanly. The friction is architectural fit, not technical feasibility: promptfoo's core value is matrix comparison across many prompts/providers/test-cases, which is more machinery than a single fixed agent's regression suite needs, and its cost-tracking assertions don't auto-detect OpenRouter usage behind a custom provider (you'd have to surface `tokenUsage`/cost yourself from the `ai` SDK result).

Given the project already leans on **Vitest** for all testing, the lowest-friction alternative is **`autoevals`** (Braintrust's standalone, OSS scoring-function library) used directly inside ordinary `it()` blocks — zero new CLI, zero new config format, zero hosted account, and a scorer contract (`{output, expected, input} → {name, score}`) that maps directly onto the 5 numeric dimensions and pass/fail verdict. If richer eval semantics are wanted later (per-case tables, an AI-SDK-wired judge harness, purpose-built `StructuredOutputJudge` helpers), **`vitest-evals`** (Sentry, OSS) is the natural next step because it extends the real `vitest` runner rather than forking into a separate process — unlike **evalite**, which ships its own CLI and has an open, unresolved issue about breaking when nested inside plain Vitest `describe()` blocks, and is still pre-1.0/experimental. **Braintrust** (hosted) and Python-only tools (**DeepEval**, **OpenAI Evals** — the latter also being sunset Oct/Nov 2026) were ruled out as either overkill or wrong-runtime for this project.

## Detailed Findings

### Current state of `tools/code-reviewer`

- **`index.ts`** ([tools/code-reviewer/index.ts](https://github.com/dorianfriede/10x-fiszki/blob/7fb417f8602c35608b39cd5c7c0b21fb0e5a1db6/tools/code-reviewer/index.ts)) — reads a git diff from stdin, builds `new ToolLoopAgent({ model, instructions: SYSTEM_PROMPT, output: Output.object({ schema: reviewResultSchema }), stopWhen: isStepCount(2) })` **inline inside `main()`** (lines 38-43), calls `.generate()`, re-validates with `reviewResultSchema.parse(result.output)`, prints JSON. No function is exported — the agent cannot be imported and invoked from another module (e.g. a test file or an eval provider) without either refactoring or spawning the CLI as a subprocess.
- **`schema.ts`** ([schema.ts](https://github.com/dorianfriede/10x-fiszki/blob/7fb417f8602c35608b39cd5c7c0b21fb0e5a1db6/tools/code-reviewer/schema.ts)) — exports `reviewResultSchema` (zod) and `ReviewResult` type cleanly; this part is already reusable as-is by any eval tool that can consume/derive from a zod schema (all three OSS candidates surveyed can — either directly, or via a one-time JSON-Schema conversion for promptfoo's `is-json`).
- **`prompt.ts`** ([prompt.ts](https://github.com/dorianfriede/10x-fiszki/blob/7fb417f8602c35608b39cd5c7c0b21fb0e5a1db6/tools/code-reviewer/prompt.ts)) — exports `SYSTEM_PROMPT` as a plain string constant; equally reusable/importable as-is.
- **Not wired into CI or any npm script.** `.github/workflows/ci.yml` runs lint → Supabase-backed `npm test` (Vitest) → build; there is no reference to `tools/code-reviewer` anywhere in CI, and no `package.json` script invokes it (usage is manual: `git diff | npx tsx tools/code-reviewer/index.ts`, per the error message in `index.ts:33`).
- **Uncommitted, in-flight prompt/schema iteration** (`git diff` against HEAD `7fb417f`, working tree at review time): the rubric is being reworked live — `idiomaticity`/`complexity` dimensions replaced with a more granular `typeSafetyCompliance` + `conventionConsistency` split, `complexity` dropped entirely, `securitySafety` renamed/expanded to `securityDataAccessSafety`, and every dimension gained explicit "Fail conditions" text. This is a textbook case for eval regression coverage: there is currently no mechanism to tell whether this rubric rewrite made the reviewer's judgments better, worse, or just different on a fixed set of diffs.
- Only one commit touches this tool so far (`7fb417f`, "chore: add AI SDK skill, code-reviewer tool, and domain/team context docs", same commit that added `.agents/skills/ai-sdk/SKILL.md`).

### Promptfoo fit

- **Custom provider (in-process)**: promptfoo's `file://path.ts` provider loads a TS module exporting a class implementing `ApiProvider` with an async `callApi(prompt, context) → { output }`; `.ts` files are loaded via a bundled `tsx` loader with no extra `NODE_OPTIONS` needed (promptfoo `0.122.0`, confirmed 2026-08-04 npm release). The existing agent-construction code from `index.ts:38-46` would move into this `callApi`, which is also the same refactor needed to make the agent importable for any other test approach — i.e. **this refactor is a shared prerequisite across every option surveyed, not promptfoo-specific.**
- **Structured-output scoring**: `is-json` (against a JSON-Schema translation of `reviewResultSchema`) and `javascript` assertions (operating directly on the already-parsed output object) both fit; a `javascript` assertion returning a full `GradingResult` with `componentResults`/`namedScores` can surface all 5 dimensions individually in promptfoo's UI. `llm-rubric`/model-graded assertions are explicitly the *wrong* tool here — the provider under test is itself an LLM judge, so a second LLM re-grading it would just add noise.
- **Prompt reuse**: `file://tools/code-reviewer/prompt.ts:SYSTEM_PROMPT` lets promptfoo's own prompt-templating layer point straight at the existing export — though moot in this design, since `SYSTEM_PROMPT` would simply be imported inside the custom provider's own code rather than passed through promptfoo's templating.
- **Config**: default is `promptfooconfig.yaml`, but "Modular Configs" support writing the config in TypeScript, and a Node package API (`promptfoo.evaluate(testSuite, options)`) exists for driving evals from a script — though the eval/assertion model stays promptfoo's own; it does not become `vitest`-native.
- **CI**: `npx promptfoo eval` exits non-zero on failing assertions by default (`--fail-on-error`, or `PROMPTFOO_FAILED_TEST_EXIT_CODE` override); official `promptfoo/promptfoo-action@v1` adds `fail-on-threshold`, PR-comment posting, and `output.json` artifact upload — straightforward to add as a job/step in `.github/workflows/ci.yml`.
- **Cost tracking**: promptfoo's `type: cost` assertion is documented as "currently limited to OpenAI GPT models and custom providers that return cost information" — for this OpenRouter-via-`ai`-SDK custom provider, cost/`tokenUsage` would need to be manually surfaced in the provider's return value; there's no auto-detection through the custom-provider path.
- **ESM/Node fit**: no Python dependency for the core eval loop; promptfoo's loader explicitly handles `"type": "module"` packages and `.ts`/`.mjs` dynamic imports, matching this repo's Node 22 + ESM setup with no expected friction.
- **Multi-step agent visibility**: promptfoo treats `callApi` as an opaque box — a `ToolLoopAgent` with `stopWhen: isStepCount(2)` running internal tool round-trips is invisible to promptfoo beyond the final output (one call, one output, one cost line in its UI) unless OpenTelemetry tracing is separately wired in for trajectory assertions — likely not worth the integration cost for a 150-line tool.
- **OpenRouter**: promptfoo ships a *native* `openrouter:<model>` provider type, but using it would mean promptfoo calling OpenRouter directly and bypassing the actual `ai` SDK / `ToolLoopAgent` / zod-structured-output code entirely — i.e., testing a reimplementation instead of the real code path. The custom `file://` provider (wrapping the existing `ai`-SDK code) is the correct integration, making the built-in OpenRouter provider type a non-option here.
- **Overall shape mismatch**: promptfoo is built around comparing many prompt/provider/test-case combinations; this use case is a single fixed agent's regression suite, a narrower slice of what the tool is designed for.

### Alternatives survey (TS-native / Vitest-centric)

| Tool | Runtime fit | Hosted backend? | Runs inside existing `vitest run`? | Maturity | Fit notes |
|---|---|---|---|---|---|
| **autoevals** (Braintrust) | TS/Node, standalone scoring-function library | No (optional opt-in logging only) | Yes — plain `it()`/`expect()`, no new runner | Mature, ~990★ | Lowest friction of everything surveyed: one devDependency, no config file, no CLI. Scorer contract `{output, expected, input} → {name, score}` maps directly onto the 5 dimensions + verdict. |
| **vitest-evals** (Sentry) | TS-native Vitest extension (`describeEval`, `toSatisfyJudge` matcher) | No (LLM-judge scorers need a model, deterministic ones don't) | Yes — genuinely runs under the real `vitest` binary/CI pipeline | Active (158 commits, Sentry-maintained) | Ships `StructuredOutputJudge()`/`ToolCallJudge()` built for exactly this kind of structured-JSON scoring; explicit AI SDK harness adapter. Natural upgrade path from autoevals if richer eval semantics are wanted later. |
| **evalite** (mattpocock) | TS-native, "Vitest/Jest for LLM apps" | No, local SQLite + local UI (`localhost:3006`) | **No** — runs via its own `evalite` CLI; open issue #155 shows nesting inside plain Vitest `describe()` breaks/duplicates test names | Beta, pre-1.0, breaking changes expected | Attractive design (per-dimension scorer columns, AI SDK-aware docs) but architecturally forks away from the existing `vitest run` pipeline rather than extending it. |
| **Braintrust** (hosted) | N/A (platform) | Yes — closed-source UI/storage; SDKs/`autoevals` are OSS | N/A | Mature, well-funded (Series B, ~$800M valuation, Feb 2026) | Free tier exists but jumps straight to ~$249/mo Pro; buys team dashboards/production monitoring this solo project doesn't need. Everything actually useful here is available for free via standalone `autoevals`. |
| **DeepEval** | Python-only (`pip install deepeval`, Python ≥3.9) | Optional hosted (Confident AI) | N/A | Mature | Excluded — wrong runtime for an all-TypeScript repo. |
| **OpenAI Evals** (OSS framework) | Python 3.9+ | No | N/A | Being sunset — read-only Oct 31 2026, shutdown Nov 30 2026 | Excluded — wrong runtime, and the project itself is end-of-life. |
| OpenAI's newer hosted "Evals" (Platform API) | API-driven, OpenAI-only | Yes, OpenAI-hosted | N/A | Current | Excluded — this tool calls OpenRouter, not the OpenAI API directly; wrong vendor lock-in. |

## Code References

- `tools/code-reviewer/index.ts:38-46` — agent construction is inline in `main()`, the concrete blocker for "importability of the agent" regardless of which eval tool is chosen.
- `tools/code-reviewer/schema.ts:6-72` — `reviewResultSchema`/`ReviewResult`, already cleanly exported and reusable.
- `tools/code-reviewer/prompt.ts:1-37` — `SYSTEM_PROMPT`, already cleanly exported and reusable.
- `.github/workflows/ci.yml:1-38` — current CI job (lint → Supabase-backed `npm test` → build); no eval step exists yet, and this is where a promptfoo/`vitest-evals` gate would be added.
- `vitest.config.ts` (via `astro/config`'s `getViteConfig`) — confirms Vitest v4, `environment: "node"`, `globals: true`, already the project's sole test runner — the strongest argument for `autoevals`/`vitest-evals` over introducing a second, parallel eval CLI.
- `package.json:40-70` — confirms `ai@^7.0.79`, `@openrouter/ai-sdk-provider@^3.0.0`, `zod@^4.4.3`, `vitest@^4.1.10` already present; no eval library present yet.

## Architecture Insights

- The prompt/schema pair in `tools/code-reviewer` is tightly coupled (each dimension's rubric text lives in both `schema.ts`'s `.describe()` and `prompt.ts`'s numbered list) — any eval harness that wants to assert per-dimension thresholds is really asserting against a rubric defined in two places at once. Worth flagging if this becomes a recurring change pattern (a single source of truth for rubric text could reduce future drift, though that's a separate refactor from adding evals).
- The project's "single test runner" convention (Vitest via `astro/config`) is a real, load-bearing constraint here: it's the deciding factor between "adopt a second, standalone eval CLI" (promptfoo, evalite) vs. "extend the existing pipeline" (autoevals, vitest-evals) — and the latter path costs strictly fewer moving parts for a single, already-small agent.
- Regardless of eval-tool choice, the same one refactor unblocks every option: extract the `ToolLoopAgent` construction + `.generate()` call out of `index.ts`'s `main()` into an exported function (e.g. `reviewDiff(diff: string): Promise<ReviewResult>`), which `main()` then calls for the CLI path and which any eval provider/test file calls for the eval path.

## Historical Context (from prior changes)

- `context/architect-report.md` (module-4 architect audit, 2026-08-25, Polish-language source) — section 5, under the DDD analysis of this same codebase, explicitly names the AI invariant "no extractable concepts → zero proposals" (I1) as the highest product-risk invariant found, but **deliberately excludes it** from the Aggregate/Repository refactor scope because "a nondeterministic-model judgment-quality problem doesn't fit that pattern," recommending instead "a separate evaluation harness in CI" (`osobny harness ewaluacyjny w CI`) as its own initiative. Section 6 confirms the human reviewer explicitly accepted this AI recommendation.
- `context/team/opportunity-map.md` (2026-08-25) — independently arrives at the same gap via a different lens (team-friction/opportunity mapping): "No automated verification of the core AI invariant... None [existing coverage]... Golden-set fixture script (~10 cases)... Internal tool → Review/CI gate," citing the architect report and domain docs as its source signals, and ranking it the #1 recommended candidate specifically because it's "the only candidate directly tied to the product's stated success metric (75% flashcard-proposal acceptance rate) with zero existing coverage today." Note: this prior candidate targets the flashcard-*generation* path (`src/lib/openrouter.ts`), not `tools/code-reviewer` — a related but distinct AI surface in the same codebase; both share the same "no eval coverage for an LLM judgment call" pattern.
- `context/domain/02-invariant-aggregate-refactor.md` — the underlying domain document the architect report summarizes; not re-read in full for this research, but referenced above as the source of the I1 vs. I2+I3 scoping decision.
- No prior `context/changes/**` or `context/archive/**` folder addresses eval tooling directly — `code-review-evals` is a new change folder created for this research.

## Related Research

- None yet under `context/changes/**/research.md` or `context/archive/**/research.md` — this is the first research artifact on eval tooling.

## Open Questions

- Should the extracted, importable agent function live in `tools/code-reviewer/index.ts` (renamed/restructured) or a new `tools/code-reviewer/agent.ts`, keeping `index.ts` as a thin CLI wrapper? Not decided here — a planning-stage decision.
- What should the initial golden-set of diffs look like (how many, what risk categories — matching the ~8-12 fixture count already proposed for the separate flashcard-generation eval in `opportunity-map.md`)? Not scoped in this research.
- Should dimension-level scoring use fixed thresholds (e.g. "assert `implementationCorrectness >= 7` on this known-good diff") or relative/golden-output comparison? Depends on how stable the rubric is expected to be — currently mid-iteration (see uncommitted diff noted above), which argues for starting with a small, deliberately loose fixture set rather than tight thresholds.
- Cost: any real (paid) OpenRouter model swapped in later would make every CI run of an eval suite a real-money cost per PR — worth deciding a run cadence (every PR vs. on-demand/nightly) before wiring a gate into `.github/workflows/ci.yml`.
