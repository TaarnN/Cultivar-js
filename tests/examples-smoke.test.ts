import { describe, expect, test } from "bun:test";

type PromptFn = (message?: string) => string | null;

function runtimeGlobal(): typeof globalThis & { prompt: PromptFn | undefined } {
  return globalThis as typeof globalThis & { prompt: PromptFn | undefined };
}

describe("examples", () => {
  test("simple example runs", async () => {
    await import("../examples/simple.ts");
    expect(true).toBe(true);
  });

  test("medium example runs", async () => {
    await import("../examples/medium.ts");
    expect(true).toBe(true);
  });

  test("advanced example runs", async () => {
    const previousPrompt = runtimeGlobal().prompt;
    runtimeGlobal().prompt = () => "0";
    try {
      await import("../examples/advanced.ts");
      expect(true).toBe(true);
    } finally {
      runtimeGlobal().prompt = previousPrompt;
    }
  });

  test("cli example runs", async () => {
    const previousPrompt = runtimeGlobal().prompt;
    runtimeGlobal().prompt = () => "done 0";
    try {
      await import("../examples/cli.ts");
      expect(true).toBe(true);
    } finally {
      runtimeGlobal().prompt = previousPrompt;
    }
  });
});
