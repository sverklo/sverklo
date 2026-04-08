// Shared helpers for identifying test files and the test files that
// conventionally cover a given source file. Extracted so both test-map and
// review-diff (risk scoring) can ask "is this file tested?" without
// duplicating the patterns.

import { basename } from "node:path";

const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /_test\.go$/,
  /_test\.py$/,
  /(^|\/)test_[^/]+\.py$/,
  /Test\.java$/,
  /Tests\.java$/,
  /Spec\.scala$/,
  /_spec\.rb$/,
  /(^|\/)spec\//,
  /\.test\.exs$/,
  /(^|\/)test\/.*\.exs$/,
];

export function isTestPath(path: string): boolean {
  return TEST_FILE_PATTERNS.some((re) => re.test(path));
}

/**
 * Generate the candidate test filenames that conventionally cover a source file.
 *   src/foo/bar.ts → bar.test.ts, bar.spec.ts
 *   src/foo/bar.py → test_bar.py, bar_test.py
 *   com/Foo.java  → FooTest.java, FooTests.java
 */
export function candidateTestNames(sourcePath: string): string[] {
  const file = basename(sourcePath);
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return [];
  const stem = file.slice(0, dot);
  const ext = file.slice(dot);

  const names: string[] = [];

  if (/\.[jt]sx?$/.test(ext)) {
    names.push(`${stem}.test${ext}`, `${stem}.spec${ext}`);
  }
  if (ext === ".py") {
    names.push(`test_${stem}.py`, `${stem}_test.py`);
  }
  if (ext === ".go") {
    names.push(`${stem}_test.go`);
  }
  if (ext === ".java" || ext === ".kt" || ext === ".scala") {
    names.push(`${stem}Test${ext}`, `${stem}Tests${ext}`, `${stem}Spec${ext}`);
  }
  if (ext === ".rb") {
    names.push(`${stem}_spec.rb`, `${stem}_test.rb`);
  }
  if (ext === ".rs") {
    names.push(`${stem}_test.rs`);
  }
  if (ext === ".ex") {
    names.push(`${stem}_test.exs`);
  }

  return names;
}
