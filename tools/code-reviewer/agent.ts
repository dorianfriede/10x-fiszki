import process from "node:process";
import { ToolLoopAgent, isStepCount, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { reviewResultSchema, type ReviewResult } from "./schema.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";

export const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

export async function reviewDiff(diff: string, model: string = DEFAULT_MODEL): Promise<ReviewResult> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file next to cwd — assume the environment already provides OPENROUTER_API_KEY.
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env or export it before running the reviewer.");
  }

  const openrouter = createOpenRouter({ apiKey });

  const reviewer = new ToolLoopAgent({
    model: openrouter(model),
    instructions: SYSTEM_PROMPT,
    output: Output.object({ schema: reviewResultSchema }),
    stopWhen: isStepCount(2),
  });

  const result = await reviewer.generate({
    prompt: `Review the following diff:\n\n${diff}`,
  });

  return reviewResultSchema.parse(result.output);
}
