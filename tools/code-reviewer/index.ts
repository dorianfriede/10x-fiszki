import process from "node:process";
import { reviewDiff } from "./agent.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file next to cwd — assume the environment already provides OPENROUTER_API_KEY.
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY is not set. Add it to .env or export it before running the reviewer.");
    process.exit(1);
  }

  const diff = (await readStdin()).trim();
  if (!diff) {
    console.error("No diff received on stdin. Usage: git diff | npx tsx tools/code-reviewer/index.ts");
    process.exit(1);
  }

  const review = await reviewDiff(diff);
  console.log(JSON.stringify(review, null, 2));
}

main().catch((error: unknown) => {
  console.error("Code review failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
