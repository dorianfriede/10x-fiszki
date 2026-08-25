import type { ApiProvider, ProviderOptions, ProviderResponse } from "promptfoo";
import { reviewDiff, DEFAULT_MODEL } from "../agent.ts";

export default class CodeReviewerProvider implements ApiProvider {
  private providerId: string;
  private model: string;

  constructor(options: ProviderOptions) {
    this.providerId = options.id ?? "code-reviewer";
    const config = options.config as { model?: string } | undefined;
    this.model = config?.model ?? DEFAULT_MODEL;
  }

  id(): string {
    return this.providerId;
  }

  async callApi(prompt: string): Promise<ProviderResponse> {
    const output = await reviewDiff(prompt, this.model);
    return { output };
  }
}
