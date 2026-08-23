import { getViteConfig } from "astro/config";
import { configDefaults } from "vitest/config";

export default getViteConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    pool: "vmThreads",
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
