export {
  SeedParser,
  SeedSerializer,
  SeedWrapper,
} from "../compat/seed-format.ts";

import {
  SeedParser,
  SeedSerializer,
  SeedWrapper,
  type Seed,
} from "../compat/seed-format.ts";
import {
  SeedCorruptedError,
  UnsupportedSeedVersionError,
  WrappedSeedDecodeError,
} from "../utils/errors.ts";

export function parseSeedBytes(data: Uint8Array): Seed {
  try {
    return SeedParser.parse(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unsupported seed version/i.test(message)) {
      throw new UnsupportedSeedVersionError(message, { cause: error });
    }
    throw new SeedCorruptedError(message, { cause: error });
  }
}

export function serializeSeed(seed: Seed): Uint8Array {
  return SeedSerializer.serialize(seed);
}

export function wrapSeed(seed: Seed): string {
  return SeedWrapper.wrap(seed);
}

export function unwrapSeed(encoded: string): Seed {
  try {
    return SeedWrapper.unwrap(encoded);
  } catch (error) {
    throw new WrappedSeedDecodeError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}
