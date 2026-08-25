import { z } from "zod";

const scale = (dimension: string, low: string, high: string) =>
  `${dimension}, on a 1-10 scale where 1 means ${low} and 10 means ${high}.`;

export const reviewResultSchema = z.object({
  implementationCorrectness: z
    .number()
    .min(1)
    .max(10)
    .describe(
      scale(
        "Implementation correctness & edge-case safety",
        "the change is broken, contradicts what it claims to do, or leaves visible edge cases (null/undefined, empty collections, unhandled error branches) unhandled",
        "the logic is fully correct and every edge case visible in the diff is handled",
      ),
    ),
  typeSafetyCompliance: z
    .number()
    .min(1)
    .max(10)
    .describe(
      scale(
        "Type safety & static-analysis compliance",
        "the diff introduces `any`, unjustified `@ts-ignore`/`eslint-disable`, non-null assertions used to silence errors, or unused vars/params",
        "fully typed with no escape hatches; would pass strict type-checked linting as-is",
      ),
    ),
  securityDataAccessSafety: z
    .number()
    .min(1)
    .max(10)
    .describe(
      scale(
        "Security & data-access boundary safety",
        "the diff leaks a secret, is missing an auth/ownership check on a mutating path, or passes unvalidated external input into a query, shell command, or rendered output",
        "no security or unsafe-data-handling concerns; all external input is validated and access is properly scoped",
      ),
    ),
  testRiskCoverage: z
    .number()
    .min(1)
    .max(10)
    .describe(
      scale(
        "Test coverage for introduced risk",
        "risky behavior changes ship with no meaningful test coverage",
        "the changed behavior is well covered by tests at the appropriate level",
      ),
    ),
  conventionConsistency: z
    .number()
    .min(1)
    .max(10)
    .describe(
      scale(
        "Convention consistency (idiomaticity)",
        "the code fights or duplicates the language/framework/codebase's established conventions and patterns instead of reusing them",
        "it reads as if a senior maintainer of this codebase wrote it, consistently reusing existing patterns",
      ),
    ),
  verdict: z
    .enum(["pass", "fail"])
    .describe(
      "Overall verdict: 'pass' if the diff is safe to merge as-is, 'fail' if it has at least one blocking issue.",
    ),
  summary: z
    .string()
    .describe("A concise 2-4 sentence summary explaining the verdict and the most important findings."),
});

export type ReviewResult = z.infer<typeof reviewResultSchema>;
