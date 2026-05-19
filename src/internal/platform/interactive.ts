import type { InteractiveIO } from "../../public/tune.ts";
import { InteractiveAbortError, InteractiveIOUnavailableError } from "../utils/errors.ts";

type PromptFn = (message?: string) => string | null;

export interface ResolvedInteractiveIO {
  prompt(message: string): Promise<string | null>;
  print(line: string): void;
  colorEnabled: boolean;
}

export function resolveInteractiveIO(io?: InteractiveIO): ResolvedInteractiveIO {
  const prompt = io?.prompt;
  const print = io?.print ?? ((line: string) => console.log(line));
  const colorEnabled = io?.color ?? !Boolean(process.env.NO_COLOR);

  return {
    async prompt(message: string) {
      if (prompt) {
        try {
          return await prompt(message);
        } catch (error) {
          throw toInteractivePromptError(error);
        }
      }
      const runtimePrompt = (globalThis as typeof globalThis & { prompt?: PromptFn }).prompt;
      if (typeof runtimePrompt !== "function") {
        throw new InteractiveIOUnavailableError(
          "Interactive tuning requires prompt() support or an injected io.prompt handler",
        );
      }
      try {
        return runtimePrompt(message);
      } catch (error) {
        throw toInteractivePromptError(error);
      }
    },
    print,
    colorEnabled,
  };
}

export function colorize(
  io: Pick<ResolvedInteractiveIO, "colorEnabled">,
  code: string,
  text: string,
): string {
  if (!io.colorEnabled) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function toInteractivePromptError(error: unknown): InteractiveAbortError {
  if (error instanceof InteractiveAbortError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("sigint") ||
    normalized.includes("ctrl+c") ||
    normalized.includes("interrupt") ||
    normalized.includes("abort") ||
    normalized.includes("cancel")
  ) {
    return new InteractiveAbortError(
      "Interactive tuning was aborted by the user.",
      { cause: error },
    );
  }

  return new InteractiveAbortError(
    "Interactive tuning was aborted while waiting for input.",
    { cause: error },
  );
}
