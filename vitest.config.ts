import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default 5s is tight for indexer/migration tests on Windows runners
    // where cold filesystem ops dominate. Mac/Linux finish those tests in
    // well under a second; Windows occasionally crosses 5s.
    testTimeout: 15000,
  },
});
