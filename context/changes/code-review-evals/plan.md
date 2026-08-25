# Promptfoo Eval Configuration for `tools/code-reviewer` — Implementation Plan

## Overview

Introduce a first promptfoo eval configuration for `tools/code-reviewer` that runs the existing code-review prompt against three OpenRouter models (`z-ai/glm-5.1`, `deepseek/deepseek-v4-flash`, and the tool's current default `nvidia/nemotron-3-super-120b-a12b:free`) on one deliberately-flawed React 16→19 migration diff. An independent judge model grades whether each review's summary correctly identifies each of the 3 injected flaws, and a deterministic assertion confirms each review returns `verdict: 'fail'`.

## Current State Analysis

`tools/code-reviewer` is a 3-file CLI (`index.ts`, `schema.ts`, `prompt.ts`, ~150 lines) built on the Vercel AI SDK (`ai` v7 `ToolLoopAgent`) with an OpenRouter provider and a zod-validated 5-dimension + verdict structured output (`tools/code-reviewer/schema.ts:6-72`). It has no automated tests, no CI wiring, and — critically — the agent is constructed inline inside `index.ts`'s `main()` (`tools/code-reviewer/index.ts:38-46`), so it cannot be imported and invoked from another module without either a refactor or shelling out to the CLI. `schema.ts` and `prompt.ts` are already cleanly exported and reusable as-is. Full detail in `context/changes/code-review-evals/research.md`.

## Desired End State

Running `npm run eval:code-reviewer` drives `npx promptfoo eval` against a config that: (a) calls the real `reviewDiff` code path once per model for all 3 models under test, (b) deterministically asserts each returned `verdict` is `'fail'`, and (c) uses an independent judge model to grade whether each review's `summary` names each of the 3 injected flaws. A passing run gives a first, concrete comparison of how reliably each of the 3 models catches the same known set of flaws on the same input, using the tool's actual production code path rather than a reimplementation. The refactor that makes this possible (an importable `reviewDiff` function) also leaves the CLI usage (`git diff | npx tsx tools/code-reviewer/index.ts`) behaviorally unchanged.

### Key Discoveries:

- `tools/code-reviewer/index.ts:38-46` — inline `ToolLoopAgent` construction is the reason the CLI isn't importable; extracting it is a shared prerequisite regardless of eval tool (confirmed in research).
- promptfoo's `file://path.ts` custom provider receives per-provider YAML `config:` via `ProviderOptions.config` in its constructor, and three separate `providers:` entries can point at the same `file://` module with different `config.model` + `label` values to produce 3 distinct comparison columns (verified via Context7 `/promptfoo/promptfoo` this session).
- OpenRouter model slugs verified live against `https://openrouter.ai/api/v1/models`: `z-ai/glm-5.1` and `deepseek/deepseek-v4-flash` both exist exactly as named. `anthropic/claude-sonnet-5` was verified live and chosen as the independent judge model — a distinct provider family from both models under test and from the existing default.
- promptfoo's `llm-rubric` assertion accepts a `transform:` option (e.g. `transform: output.summary`) to grade a specific sub-field of a structured/object provider output, and `defaultTest.options.provider` overrides which model grades all `llm-rubric` assertions — set to `openrouter:anthropic/claude-sonnet-5`, this lets promptfoo's own *native* OpenRouter provider type serve the judge role (fine, since the judge isn't the code under test) while every provider *under test* still goes through the custom `file://` wrapper around the real `reviewDiff` code (mandatory, since promptfoo's native OpenRouter provider type would otherwise bypass the actual `ai`-SDK/`ToolLoopAgent` code entirely). One `OPENROUTER_API_KEY` covers both roles.
- promptfoo's `javascript` assertion receives the provider's `output` already as a parsed object (not a string) — `value: "output.verdict === 'fail'"` works directly with no `JSON.parse`.

## What We're NOT Doing

- No CI wiring — this is a local-only `npm run eval:code-reviewer` script for now, per explicit scope decision; a follow-up change can add a CI gate once a run cadence (every PR vs. on-demand) is decided.
- No cost/`tokenUsage` surfacing in the custom provider's `ProviderResponse` — promptfoo's `type: cost` assertions don't auto-detect a custom OpenRouter-via-`ai`-SDK provider, and wiring that up is out of scope for this first configuration.
- No `repeat`/majority-vote handling for LLM nondeterminism — each provider runs once against the fixture for this first configuration.
- No per-dimension numeric-threshold assertions (e.g. asserting a specific dimension score is below N) — only the holistic `verdict === 'fail'` deterministic check and the flaw-specific judge checks. The 5-dimension rubric in `schema.ts`/`prompt.ts` is still being actively hand-tuned (an uncommitted rubric rewrite exists as of this research), so tying assertions to specific dimension names now would be brittle.
- No broader golden-set of fixture diffs beyond the one React-migration case — this is explicitly the first configuration, not the full fixture set.
- No refactor to single-source the rubric text currently duplicated between `schema.ts`'s `.describe()` calls and `prompt.ts`'s numbered list — flagged in research as a separate, unrelated cleanup.
- No changes to `README.md`'s "Available Scripts" list or to `.github/workflows/ci.yml`.

## Implementation Approach

Extract the agent into an importable, model-parameterized function first (Phase 1) — this unblocks both the CLI (unchanged behavior) and the new promptfoo provider from the same code path. Then author the fixture and the provider adapter that wraps that function (Phase 2), keeping the flaw content and the promptfoo integration code separable so each can be reviewed on its own terms. Finally wire the promptfoo config that ties 3 model-parameterized provider instances, the fixture, and both assertion types together (Phase 3).

## Critical Implementation Details

**Keep both API-key checks.** `index.ts`'s existing `OPENROUTER_API_KEY` presence check (before reading stdin) must stay in place for the CLI's exact current error message/exit-code UX — do not delete it when extracting `agent.ts`. `agent.ts`'s `reviewDiff` must perform its *own* independent env-load-and-check (throwing a plain `Error`, never `process.exit`), because the promptfoo provider imports `reviewDiff` directly and never goes through `index.ts`'s `main()`. The two checks are not redundant — they guard two different call paths.

**The provider ignores promptfoo's templating context.** The config's `prompts:` entry is the trivial passthrough `"{{diff}}"`; promptfoo renders this to the fixture's raw diff text and hands it to `callApi(prompt)` as the `prompt` argument. The custom provider must use that `prompt` argument directly as the diff string passed to `reviewDiff` — it does not need to read `context.vars.diff` itself, since promptfoo has already done the substitution before calling `callApi`.

## Phase 1: Extract an importable `reviewDiff` agent

### Overview

Move the `ToolLoopAgent` construction and generation call out of `index.ts`'s `main()` into a new, model-parameterized, exported function, so it can be reused by both the CLI and the promptfoo provider (Phase 2) without shelling out.

### Changes Required:

#### 1. New agent module

**File**: `tools/code-reviewer/agent.ts`

**Intent**: Provide a single importable entry point for running a code review, parameterized by model, usable by any caller (CLI or eval provider) without duplicating the OpenRouter/`ToolLoopAgent`/schema-parsing logic.

**Contract**: Exports `DEFAULT_MODEL` (the string currently hardcoded as `MODEL` in `index.ts`, unchanged value) and `async function reviewDiff(diff: string, model: string = DEFAULT_MODEL): Promise<ReviewResult>`. Internally: best-effort `process.loadEnvFile()` (same try/catch-and-ignore pattern as today), reads `process.env.OPENROUTER_API_KEY` and throws `new Error("OPENROUTER_API_KEY is not set. Add it to .env or export it before running the reviewer.")` if absent, builds `createOpenRouter({ apiKey })`, constructs the `ToolLoopAgent` exactly as today but with `model: openrouter(model)`, calls `.generate({ prompt: \`Review the following diff:\n\n${diff}\` })`, and returns `reviewResultSchema.parse(result.output)`.

#### 2. Thin CLI wrapper

**File**: `tools/code-reviewer/index.ts`

**Intent**: Reduce `main()` to stdin-reading, calling `reviewDiff`, and printing JSON — no behavior change for existing CLI users.

**Contract**: Keeps the existing `readStdin`, env-load, `OPENROUTER_API_KEY` presence check (before reading stdin, unchanged message/exit code), and empty-diff check exactly as today. Replaces the inline `createOpenRouter(...)` / `new ToolLoopAgent(...)` / `.generate(...)` / `reviewResultSchema.parse(...)` block with a single `const review = await reviewDiff(diff);` call (passing no explicit model, so it uses `DEFAULT_MODEL`), then continues to `console.log(JSON.stringify(review, null, 2))` unchanged. The outer `main().catch(...)` handler is untouched.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run lint` (type-checked ESLint) reports no new errors on `tools/code-reviewer/*.ts`
- [ ] `npx astro check` (or equivalent project type-check) passes with no new errors

#### Manual Verification:

- [ ] `git diff | npx tsx tools/code-reviewer/index.ts` against a real small diff still produces the same JSON shape as before the refactor (same top-level keys, still exits 0 on success)
- [ ] Removing `OPENROUTER_API_KEY` from the environment and re-running the CLI still prints the original "OPENROUTER_API_KEY is not set..." message and exits 1

---

## Phase 2: Author the fixture diff and the promptfoo provider

### Overview

Create the flawed React 16→19 migration fixture and the promptfoo `ApiProvider` adapter that wraps `reviewDiff`, so Phase 3 has both pieces ready to wire into a config.

### Changes Required:

#### 1. Fixture diff

**File**: `tools/code-reviewer/eval/fixtures/user-search-form-migration.diff`

**Intent**: A realistic unified diff simulating a careless migration of a `UserSearchForm` debounced search component (and its test file) from a React 16 class component to a React 19 function component, injecting exactly three independently-catchable, real regressions rather than stylistic nitpicks:

1. **Dropped `defaultProps`**: the migrated function component keeps `UserSearchForm.defaultProps = { pageSize: 10 }` as a static-style assignment instead of converting it to an ES6 default parameter. React 19 silently ignores `defaultProps` on function components (no warning, no error), so `pageSize` becomes `undefined` whenever a caller omits it — a genuine edge-case/correctness regression.
2. **Dead `propTypes`**: `UserSearchForm.propTypes = { onResults: PropTypes.func.isRequired, ... }` is carried over unchanged. React 19 no longer runs any PropTypes checks, so a caller that omits `onResults` gets no dev-time warning at all and the component instead throws at runtime the first time it calls `onResults(data)` — a type-safety regression masquerading as intact type safety.
3. **Test quietly disabled**: the test that exercised search-on-change behavior via `react-dom/test-utils`'s `Simulate`/`renderIntoDocument` (removed/erroring in React 19, unlike `act`, which merely moved to importing from `react`) is changed to `it.skip(...)` with a `// TODO` comment instead of being migrated to `@testing-library/react` — silently dropping coverage of the exact behavior the migration touched.

**Contract**: Valid unified-diff format (`--- a/...` / `+++ b/...` hunks, realistic file paths such as `src/components/UserSearchForm.jsx` and its test file) covering both the component and its test in one diff, long and detailed enough to read like a real PR — not a toy 5-line snippet. Authored directly as static fixture content (fictional paths are fine; the diff is never applied to a real tree, only fed as text to the reviewer).

#### 2. Promptfoo custom provider

**File**: `tools/code-reviewer/eval/promptfoo-provider.ts`

**Intent**: Adapt `reviewDiff` to promptfoo's `ApiProvider` interface so promptfoo can drive the real review code in-process, once per configured model, without reimplementing any of the OpenRouter/`ToolLoopAgent` logic.

**Contract**:

```typescript
import type { ApiProvider, ProviderOptions, ProviderResponse } from "promptfoo";
import { reviewDiff, DEFAULT_MODEL } from "../agent.ts";

export default class CodeReviewerProvider implements ApiProvider {
  private providerId: string;
  private model: string;

  constructor(options: ProviderOptions) {
    this.providerId = options.id ?? "code-reviewer";
    this.model = (options.config?.model as string) ?? DEFAULT_MODEL;
  }

  id(): string {
    return this.providerId;
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    const output = await reviewDiff(prompt, this.model);
    return { output };
  }
}
```

(Included because the `ApiProvider` shape and the `options.config?.model` access path are the exact non-obvious contract the Phase 3 YAML config depends on.)

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run lint` reports no new errors on the new `eval/` files
- [ ] Fixture diff is syntactically valid: `git apply --stat tools/code-reviewer/eval/fixtures/user-search-form-migration.diff` parses without error

#### Manual Verification:

- [ ] Read through the fixture diff and confirm each of the 3 flaws is present, realistic, and independently identifiable without relying on the other two

---

## Phase 3: Wire the promptfoo configuration

### Overview

Tie the 3 model-parameterized provider instances, the fixture test case, and both assertion types (deterministic + LLM-judge) together into a runnable promptfoo config, and make it runnable via a standard npm script.

### Changes Required:

#### 1. Promptfoo config

**File**: `tools/code-reviewer/eval/promptfooconfig.yaml`

**Intent**: Define the eval matrix: 3 providers (same custom module, different `config.model`), one shared fixture test case, a deterministic verdict check, and 3 independent flaw-detection judge checks graded by a model distinct from all 3 under test.

**Contract**:

```yaml
providers:
  - id: file://./promptfoo-provider.ts
    label: z-ai/glm-5.1
    config:
      model: z-ai/glm-5.1
  - id: file://./promptfoo-provider.ts
    label: deepseek-v4-flash
    config:
      model: deepseek/deepseek-v4-flash
  - id: file://./promptfoo-provider.ts
    label: nemotron-3-super-120b (default)
    config:
      model: nvidia/nemotron-3-super-120b-a12b:free

prompts:
  - "{{diff}}"

defaultTest:
  options:
    provider: openrouter:anthropic/claude-sonnet-5

tests:
  - vars:
      diff: file://./fixtures/user-search-form-migration.diff
    assert:
      - type: javascript
        value: "output.verdict === 'fail'"
      - type: llm-rubric
        transform: output.summary
        value: >-
          The review identifies that `defaultProps` was left on the migrated function component,
          which React 19 silently ignores, leaving `pageSize` undefined when a caller omits it.
      - type: llm-rubric
        transform: output.summary
        value: >-
          The review identifies that the `propTypes` declaration on `onResults` no longer provides
          any runtime or dev-time safety in React 19, so a missing `onResults` prop will crash instead
          of warn.
      - type: llm-rubric
        transform: output.summary
        value: >-
          The review identifies that the test covering search-on-change behavior was disabled
          (`.skip`) instead of migrated off the removed `react-dom/test-utils`, silently dropping
          coverage.
```

(Included because the exact `providers`/`defaultTest.options.provider`/`transform` keys are the non-obvious API surface every other decision in this plan routes through.)

#### 2. npm script and dependency

**File**: `package.json`

**Intent**: Make the eval runnable with a standard command, matching how every other project task is invoked.

**Contract**: Add `"eval:code-reviewer": "promptfoo eval -c tools/code-reviewer/eval/promptfooconfig.yaml"` to `scripts`. Add `promptfoo` to `devDependencies` via `npm install --save-dev promptfoo` (verified live at `^0.122.0` as of this research; let npm resolve the current version rather than hand-pinning a possibly-stale one).

### Success Criteria:

#### Automated Verification:

- [ ] `npm run eval:code-reviewer` exits 0 — all 3 providers' outputs satisfy the deterministic assertion and all 3 `llm-rubric` assertions

#### Manual Verification:

- [ ] Open the promptfoo report (`npx promptfoo view`, or read the printed summary table) and confirm the judge's rationale for each `llm-rubric` result reads sensibly — the LLM judge itself could be wrong, so a human spot-check of at least one pass and one (if any) fail is required
- [ ] Re-run `git diff | npx tsx tools/code-reviewer/index.ts` against a real diff once more, confirming the CLI path still works end-to-end after all three phases

---

## Testing Strategy

### Unit Tests:

None added in this plan. Correctness checking for the reviewed output is handled entirely by the promptfoo config's assertions (Phase 3) — this is a deliberate scope decision (promptfoo over extending the existing Vitest suite), consistent with the research doc's finding that this refactor doesn't require new Vitest coverage to become eval-ready.

### Integration Tests:

The promptfoo eval run itself (`npm run eval:code-reviewer`) is the integration test: it exercises the real `reviewDiff` code path, the real OpenRouter provider, and the real structured-output schema for all 3 models under test.

### Manual Testing Steps:

1. Run `npm run eval:code-reviewer` and confirm it exits 0.
2. Open the promptfoo report and read the judge rationale for at least one `llm-rubric` result per model.
3. Run the CLI once against a real, non-fixture diff to confirm Phase 1's refactor left the manual usage path unchanged.

## Performance Considerations

Each `npm run eval:code-reviewer` run makes 4 real model calls (3 providers under test + 1 judge, since the judge grades 3 assertions but promptfoo may batch/reuse the call depending on its internal grading batching — not something this plan controls). `deepseek/deepseek-v4-flash` and the existing default are inexpensive; `z-ai/glm-5.1` and the `anthropic/claude-sonnet-5` judge are non-trivial per-token cost (see research doc pricing notes) — this is a manually-triggered, not CI-gated, cost for now (see "What We're NOT Doing").

## Migration Notes

Not applicable — no persisted data or existing consumers of `tools/code-reviewer/index.ts`'s internals are affected; the CLI's external interface (stdin in, JSON stdout, same exit codes) is unchanged.

## References

- Research: `context/changes/code-review-evals/research.md`
- Agent construction to be extracted: `tools/code-reviewer/index.ts:38-46`
- Schema/prompt already reusable: `tools/code-reviewer/schema.ts:6-72`, `tools/code-reviewer/prompt.ts:1-37`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Extract an importable `reviewDiff` agent

#### Automated

- [x] 1.1 Type checking passes: `npm run lint` reports no new errors on `tools/code-reviewer/*.ts` — b8a5b10
- [x] 1.2 `npx astro check` (or equivalent project type-check) passes with no new errors — b8a5b10

#### Manual

- [x] 1.3 CLI against a real small diff still produces the same JSON shape as before the refactor — b8a5b10
- [x] 1.4 Missing `OPENROUTER_API_KEY` still prints the original message and exits 1 — b8a5b10

### Phase 2: Author the fixture diff and the promptfoo provider

#### Automated

- [x] 2.1 Type checking passes: `npm run lint` reports no new errors on the new `eval/` files
- [x] 2.2 Fixture diff is syntactically valid: `git apply --stat tools/code-reviewer/eval/fixtures/user-search-form-migration.diff` parses without error

#### Manual

- [x] 2.3 Each of the 3 flaws is present, realistic, and independently identifiable in the fixture diff

### Phase 3: Wire the promptfoo configuration

#### Automated

- [ ] 3.1 `npm run eval:code-reviewer` exits 0

#### Manual

- [ ] 3.2 Promptfoo report's judge rationale reads sensibly on manual spot-check
- [ ] 3.3 CLI still works end-to-end against a real diff after all three phases
