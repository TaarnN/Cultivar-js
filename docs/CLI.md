# CLI Tuning

`tuneCli()` is the built-in line-oriented tuner for seeded functions.

It is designed to be:

- easy to inspect in plain terminals
- easy to automate in tests
- embeddable through injected IO hooks
- compatible with Node.js package consumers

## Basic Use

```ts
const result = await fn.tuneCli({
  args: ["hello"],
  generations: 4,
  batchSize: 5,
  score: (output) => output.length,
  preview: (output) => output,
});
```

## Injected IO

Provide terminal hooks when you do not want to rely on a runtime `prompt()`.

```ts
await fn.tuneCli({
  io: {
    prompt: async (message) => {
      console.log(message);
      return "done 0";
    },
    print: (line) => console.log(line),
    color: false,
  },
});
```

This is useful for tests, custom terminal UIs, and remote orchestration.

If `prompt()` returns `null` or throws an interrupt-like error such as `SIGINT`, the CLI treats that as a graceful abort. If a current seed state already exists, it returns that state cleanly instead of discarding it.

## Selection Commands

- `[n]`: pick candidate `n` and continue.
- `pick n`: pick candidate `n` and continue.
- `done`: finish immediately with the current seed.
- `done n`: pick candidate `n` and finish immediately.
- `inspect n`: show full values and output for candidate `n`.
- `view n`: alias for `inspect n`.
- `save n <path>`: save candidate `n` to a seed file.
- `save-current <path>`: save the current seed to a file.
- `reroll`: generate a new batch from the same parent.
- `radius narrow|medium|broad`: change mutation radius and regenerate.
- `batch n`: change batch size and regenerate.
- `gens n`: set remaining generations after the next successful pick.
- `advanced`: open the advanced mutation editor.
- `settings`: show current tuning settings.
- `current`: show current seed, values, and last output.
- `help`: show the command list.
- `quit`: finish immediately with the current seed.

Malformed mixed-order commands such as `0 done` are rejected with a targeted hint. Use `0` to pick-and-continue or `done 0` to pick-and-finish.

## Tree-Aware Commands

These commands are available when the wrapper has hierarchical domains.

- `tree`: print the current domain tree.
- `inspect-domain <path>`: inspect one domain node.
- `values <path>`: print values for a domain node.
- `behavior <path>`: print behaviors for a domain node.
- `save-sub <path> <file>`: save a child seed.
- `set-sub <path> <file>`: inject a child seed and reroll.
- `lock <path>`: prevent mutations at a domain path.
- `unlock <path>`: remove a domain lock and reroll.
- `focus <path>`: focus mutations on one domain path.
- `focus clear`: clear domain focus.
- `credit`: print mutation credit scores and confidence.

## Reroll And Determinism

CLI rerolls are deterministic.

Each reroll increments `batchAttempt`, which is part of candidate seed derivation.

That means:

- reroll 0 and reroll 1 produce different batches
- reroll 1 is reproducible if you replay the same session path

## Advanced Editor

The `advanced` editor lets you change:

- `coreMutationRate`
- `coreMutationMagnitude`
- `textureGrowthCount`
- `textureEditRate`
- `textureEditMagnitude`
- `bondGrowthCount`
- `bondEditRate`
- `batchSize`
- remaining generations

Changing advanced settings regenerates the current round and increments the batch attempt.

## Screen Layout

The CLI screen shows:

- generation progress
- batch attempt number
- parent seed hash
- radius label
- survivor, rejected, and timed-out counts
- session seed prefix
- candidate previews
- candidate values when `showValues` is enabled
- active habits when experience guidance is enabled
- domain lock/focus scope when set

## Best Practices

- Keep `preview` compact and scannable.
- Use `inspect` for expensive detail instead of making `preview` huge.
- Use `score` even in CLI mode when you want candidate ranking hints.
- Save promising intermediate seeds with `save n <path>`.
- Use `current` when making manual curation decisions.
- Inject `io` in server or CI contexts instead of relying on terminal prompts.
