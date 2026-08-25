# Opportunity Map

## Context

- **Project / context**: 10xFiszki — solo internal-builder lens, signals sourced from `context/architect-report.md` and `context/domain/*.md` (Module 4 architecture/DDD audit) plus three additional frictions supplied directly by the user.
- **Data constraint**: Mock / local / read-only / non-sensitive
- **Date**: 2026-08-25

## Map

| Signal | Existing / default response | Thin complement | First useful version | Data risk | Direction if valuable |
|---|---|---|---|---|---|
| PRD drift / decisions not propagated back into governing docs | `/10x-impl-review`, `/10x-lesson` — neither closes the PRD loop specifically | Doc-sync check folded into `/10x-archive` | Local diff script, change vs. referenced PRD sections | local, non-sensitive | Review/CI gate (extend existing skill) |
| No automated verification of the core AI invariant ("no extractable concepts → zero proposals") | None | N/A — genuine gap | Golden-set fixture script (~10 cases), manual run | local/mock, real API cost per run | Internal tool → Review/CI gate |
| Manual synthesis of "is this change ready" (impl status + tests + lint/typecheck + docs) | `change.md` status field + separate CI runs | Status-summary script | Local script combining test/lint/status output | local, non-sensitive | Internal tool (small script, low growth) |
| AI context artifacts scattered across context folders | README index per `context/` subfolder already exists | N/A | N/A | N/A | No build — needs a taxonomy decision, not a tool |

Note: the original two "PRD drift" and "decisions not propagated back" signals were merged into one row — the PRD-drift instances found by the architect audit are specific cases of the general pattern, not a separate friction.

## Recommended First Candidate

```text
Candidate:
flashcard-proposal golden-set check

Reads:
A local fixture file of ~8-12 input texts (empty, gibberish, off-topic, trivial, rich-content) with
expected proposal-count ranges; calls the existing generation code path (src/lib/openrouter.ts) directly.

Returns:
A markdown/terminal report — actual proposal count vs. expected range per fixture, pass/fail.

Does not do:
Score semantic relevance or card quality (count-based signal only); block merges automatically; become
a full eval harness with a scoring rubric; replace human review of the report.

Data risk:
Local/mock fixtures, non-sensitive. One caveat: each run calls the real OpenRouter API, so it has a
small real cost — not a data-sensitivity concern, but worth knowing before wiring it into CI on every push.

Direction if it proves valuable:
Internal tool → Review/CI gate. Matures into a CI-enforced quality gate once the fixture set and
pass thresholds are stable — this is literally what the architect report already recommended as a
separate initiative, distinct from the aggregate refactor it flagged it out of.
```

## Why This Candidate

It is the only candidate directly tied to the product's stated success metric (75% flashcard-proposal
acceptance rate) with zero existing coverage today, independently flagged as the top risk by two
separate deep audits (domain distillation ranking #1, and the aggregate-refactor plan's explicit
carve-out recommending a separate evaluation harness). It validates for near-zero cost — a handful of
static text fixtures, no new infrastructure, no access-control questions. The PRD-drift candidate is
real but slower-burn (nobody feels it until an expensive audit surfaces it); the readiness-script and
context-taxonomy signals are lower-stakes solo-workflow conveniences, not coordination-cost problems.

## Next Direction If Valuable

Internal tool → Review/CI gate. Start as a manually-run local script; once the fixture set and pass
thresholds prove stable, wire it into CI as a required gate (mirroring how
`context/foundation/test-plan.md` already plans to promote unit+integration tests to a required gate).

No build path was chosen this session (user selected "Nothing for now" when asked about next steps).
