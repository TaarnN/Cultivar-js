# Publishing Checklist

Use this checklist before publishing `cultivar-js` to npm.

## Package Metadata

- Confirm `package.json` has the intended `name`, `version`, `description`, `exports`, `files`, and `engines`.
- Confirm the license decision is represented in package metadata before public release.
- Confirm `README.md` describes install, runtime support, ESM, CommonJS, TypeScript, and public docs.
- Confirm `CHANGELOG.md` has an entry for the version being published.

## Build And Test

Run:

```sh
npm run check
npm run typecheck:test
npm run test:bun
```

Then verify the package contents:

```sh
npm pack --dry-run
```

If the local npm cache has permission issues, use a temporary cache:

```sh
npm_config_cache=/private/tmp/cultivar-js-npm-cache npm pack --dry-run
```

## Consumer Smoke Test

Create a tarball and install it in a temporary consumer project.

```sh
mkdir -p /private/tmp/cultivar-js-pack /private/tmp/cultivar-js-consumer
npm_config_cache=/private/tmp/cultivar-js-npm-cache npm pack --pack-destination /private/tmp/cultivar-js-pack
npm_config_cache=/private/tmp/cultivar-js-npm-cache npm install /private/tmp/cultivar-js-pack/cultivar-js-0.1.0.tgz --prefix /private/tmp/cultivar-js-consumer
```

Verify ESM and CommonJS consumers:

```sh
node -e 'import("cultivar-js").then(async ({ seed }) => {
  const fn = seed(async ($) => $("x", { type: "u8", range: [1, 5], default: 2 }), {
    id: "consumer.esm",
    version: "1",
  });
  if (await fn() !== 2) throw new Error("bad esm");
  const cjs = require("cultivar-js");
  const errors = require("cultivar-js/errors");
  if (typeof cjs.seed !== "function" || errors.CultivarJsError.name !== "CultivarJsError") {
    throw new Error("bad cjs");
  }
})'
```

## Publish

When the version, changelog, tests, package contents, and consumer smoke test are all correct:

```sh
npm publish
```

Use `npm publish --access public` if publishing a scoped package that should be public.
