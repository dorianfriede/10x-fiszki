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
        "Implementation correctness",
        "the change is broken or does not do what it claims",
        "the logic is fully correct",
      ),
    ),
  idiomaticity: z
    .number()
    .min(1)
    .max(10)
    .describe(
      scale(
        "Idiomatic style",
        "the code fights the language/framework/codebase conventions",
        "it reads as if a senior maintainer of this codebase wrote it",
      ),
    ),
  complexity: z
    .number()
    .min(1)
    .max(10)
    .describe(
      scale("Complexity", "needlessly complex or over-engineered for what it does", "as simple as the problem allows"),
    ),
  testRiskCoverage: z
    .number()
    .min(1)
    .max(10)
    .describe(
      scale(
        "Test risk coverage",
        "risky behavior changes ship with no meaningful test coverage",
        "the changed behavior is well covered by tests",
      ),
    ),
  securitySafety: z
    .number()
    .min(1)
    .max(10)
    .describe(
      scale(
        "Security & safety",
        "the diff introduces a serious vulnerability or unsafe handling of data",
        "no security or safety concerns",
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
