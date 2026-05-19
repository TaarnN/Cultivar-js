import { TimeoutExceededError } from "./errors.ts";

export async function withTimeout<T>(
  task: PromiseLike<T> | T,
  timeoutMs: number | undefined,
  scope: string,
): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) {
    return Promise.resolve(task);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(task),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutExceededError(scope, timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
