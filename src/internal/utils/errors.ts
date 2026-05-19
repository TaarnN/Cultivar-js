export class CultivarJsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CultivarJsError";
  }
}

export class SchemaDriftError extends CultivarJsError {
  constructor(message: string) {
    super(message);
    this.name = "SchemaDriftError";
  }
}

export class SchemaDeclarationError extends CultivarJsError {
  constructor(message: string) {
    super(message);
    this.name = "SchemaDeclarationError";
  }
}

export class StableSeedRequiredError extends CultivarJsError {
  constructor(message: string) {
    super(message);
    this.name = "StableSeedRequiredError";
  }
}

export class ValidationRejectedError extends CultivarJsError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationRejectedError";
  }
}

export class SelectionError extends CultivarJsError {
  constructor(message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

export class InteractiveIOUnavailableError extends SelectionError {
  constructor(message: string) {
    super(message);
    this.name = "InteractiveIOUnavailableError";
  }
}

export class InteractiveAbortError extends SelectionError {
  constructor(message: string, options?: ErrorOptions) {
    super(message);
    this.name = "InteractiveAbortError";
    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: options.cause,
        writable: false,
      });
    }
  }
}

export class TimeoutExceededError extends CultivarJsError {
  constructor(scope: string, timeoutMs: number) {
    super(`${scope} timed out after ${timeoutMs}ms`);
    this.name = "TimeoutExceededError";
  }
}

export class CurrentSeedMissingError extends CultivarJsError {
  constructor(message: string) {
    super(message);
    this.name = "CurrentSeedMissingError";
  }
}

export class SeedCorruptedError extends CultivarJsError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SeedCorruptedError";
  }
}

export class UnsupportedSeedVersionError extends CultivarJsError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnsupportedSeedVersionError";
  }
}

export class SeedDomainMismatchError extends CultivarJsError {
  constructor(message: string) {
    super(message);
    this.name = "SeedDomainMismatchError";
  }
}

export class SeedSchemaVersionMismatchError extends CultivarJsError {
  constructor(message: string) {
    super(message);
    this.name = "SeedSchemaVersionMismatchError";
  }
}

export class WrappedSeedDecodeError extends CultivarJsError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WrappedSeedDecodeError";
  }
}

export class GenerationExhaustedError extends CultivarJsError {
  readonly generation: number;
  readonly attemptedBatchSize: number;
  readonly rejectedCount: number;
  readonly timedOutCount: number;
  readonly firstFailureMessage?: string;

  constructor(
    generation: number,
    attemptedBatchSize: number,
    rejectedCount: number,
    timedOutCount: number,
    firstFailureMessage?: string,
  ) {
    const details = [
      `Generation ${generation} produced no selectable candidates`,
      `(attempted=${attemptedBatchSize}, rejected=${rejectedCount}, timedOut=${timedOutCount})`,
      firstFailureMessage ? `first failure: ${firstFailureMessage}` : null,
    ].filter(Boolean).join(" ");
    super(details);
    this.name = "GenerationExhaustedError";
    this.generation = generation;
    this.attemptedBatchSize = attemptedBatchSize;
    this.rejectedCount = rejectedCount;
    this.timedOutCount = timedOutCount;
    this.firstFailureMessage = firstFailureMessage;
  }
}
