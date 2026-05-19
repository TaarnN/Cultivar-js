# Documentation

Welcome to the `cultivar-js` documentation.

## Consumer Docs

- [API reference](API.md): public exports, wrapper methods, tuning types, and errors.
- [CLI reference](CLI.md): `tuneCli()` command reference and IO injection.
- [Versioning](VERSIONING.md): package versions, wrapper schema versions, and binary wire versions.
- [Binary format](BINARY_FORMAT.md): seed bytes, tree envelopes, integrity checks, and compatibility notes.

## Maintainer Docs

- [Roadmap](ROADMAP.md): public-facing project direction.
- [Publishing checklist](PUBLISHING.md): package verification steps before `npm publish`.

## Package Entry Points

```ts
import { seed } from "cultivar-js";
import { SchemaDriftError } from "cultivar-js/errors";
```

```js
const { seed } = require("cultivar-js");
const { SchemaDriftError } = require("cultivar-js/errors");
```
