# @catalejo/web

The static application of Catalejo Genómico, written in TypeScript with React and Vite. It reads a release directly in the browser through DuckDB-WASM, following the release layout in [docs/data-contract.md](../../docs/data-contract.md) §6 and the pages in [docs/requirements.md](../../docs/requirements.md). At milestone 0 it renders the shell, with the wordmark, the navigation and a placeholder for each page, and it does not yet open any release file.

## Installation

The package needs Node 24 (see `.node-version` at the repository root) and pnpm. From the repository root, run the following.

```
pnpm --dir packages/web install
pnpm --dir packages/web exec playwright install chromium
```

The second command installs the Chromium build that the end-to-end tests use.

## Scripts

Each script runs as `pnpm --dir packages/web <script>` from the repository root.

| Script       | What it does                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `dev`        | Starts the Vite development server on port 5173, after running `generate` and `extensions`       |
| `build`      | Type checks and builds into `dist/` after running `generate`, then runs `scripts/check-dist.mjs` |
| `test`       | Runs the Vitest tests after running `generate` and `extensions`                                  |
| `e2e`        | Runs the Playwright tests in `e2e/`, starting the development server if none is running          |
| `lint`       | Runs ESLint and the Prettier check                                                               |
| `typecheck`  | Runs `tsc -b` after running `generate`                                                           |
| `generate`   | Writes `src/generated/` from the palette and the design tokens                                   |
| `extensions` | Fills `.cache/duckdb-extensions/` with the pinned DuckDB extensions                              |
| `preview`    | Serves the built `dist/` on port 4173, after running `extensions`                                |

The Playwright tests run in Chromium at widths of 1440 and 1024 pixels.

## Development server and release data

`pnpm --dir packages/web dev` serves the application at `http://localhost:5173` and the release files under `/data/`, the same origin path the deployed application uses. The plugin in [vite/releaseData.ts](vite/releaseData.ts) serves `releases/synth` at the repository root by default, and the environment variable `CATALEJO_RELEASE_DIR` selects another release directory, with a relative value taken from the directory pnpm was invoked in.

```
CATALEJO_RELEASE_DIR=<release directory> pnpm --dir packages/web dev
```

The plugin answers HEAD requests and byte ranges (206 with `Content-Range`, or 416 when a range cannot be satisfied) with `Content-Length` and `Accept-Ranges`, which DuckDB-WASM needs to read Parquet files in parts. The same handler serves `vite preview`. A missing release directory answers 404 without stopping the server, which is the state at milestone 0, since the release build that writes `releases/synth` arrives in milestone 1a. From milestone 1b the pages read `manifest.json` from `/data/` to learn the release identifier, the genome count and the products the release contains.

## Configuration and design tokens

Colors come from [config/palette.yaml](../../config/palette.yaml) and the typography, color roles, spacing, layout and shape from [config/design-tokens.yaml](../../config/design-tokens.yaml). [scripts/generate.ts](scripts/generate.ts) compiles both into `src/generated/palette.ts`, `src/generated/tokens.ts` and `src/generated/tokens.css`, which are committed and must not be edited by hand. `test/generated.test.ts` fails when the committed files differ from a fresh generation, and CI also checks that the generated directory is unchanged after the tests. After changing either YAML file, run `pnpm --dir packages/web generate` and commit the result.

`test/palette.test.ts` scans `src/` and `index.html` for hex colors, color functions and named colors, using the detector in `test/guards/colorLiterals.ts`, so every color reaches a component through the generated palette.

## Strings

Every user-visible string lives in [src/strings.ts](src/strings.ts), keyed by identifier, so that a translation is one more module with the same keys. `test/strings.test.ts` uses the detector in `test/guards/literalText.ts`, built on the TypeScript compiler, to fail when a component contains JSX text, a literal string rendered as a child, or a literal value in a visible attribute such as `title`, `aria-label`, `placeholder` or `alt`.

## DuckDB-WASM

The DuckDB-WASM engine files are served from the application's own origin and never from a CDN, but they are not part of the build, because each `.wasm` file is larger than the 25 MiB per file that Cloudflare Pages accepts. [src/data/engineAssets.ts](src/data/engineAssets.ts) builds every engine URL from `/assets/duckdb-wasm/<version>/`, where the version is that of the installed `@duckdb/duckdb-wasm`, injected at build time through Vite's `define` as `__DUCKDB_WASM_VERSION__`. Only the mvp and eh bundles are offered to DuckDB, so the directory holds four files, `duckdb-mvp.wasm`, `duckdb-eh.wasm`, `duckdb-browser-mvp.worker.js` and `duckdb-browser-eh.worker.js`. The threaded bundle is left out since the application does not use cross-origin isolation. [src/data/duckdb.ts](src/data/duckdb.ts) creates the database on first use and [src/data/database.ts](src/data/database.ts) loads it lazily, so the engine is fetched only when a page first needs a table.

In production the Pages Function in [functions/assets/[[path]].ts](functions/assets/[[path]].ts) answers `/assets/duckdb-wasm/*` and `/assets/duckdb-extensions/*` from the keys under `assets/` in the R2 bucket bound as `RELEASES`, which the deploy workflow uploads. It sends `application/wasm` for `.wasm` files and `text/javascript` for the workers, marks every file immutable for a year, answers `If-None-Match` with 304, and answers 503 when the binding is missing. [public/\_routes.json](public/_routes.json) limits the Function to those two prefixes, so the application's own files under `/assets/` stay static. The types the Function needs are declared in [functions/types.ts](functions/types.ts), and `functions/tsconfig.json` type checks them against the Web Worker library. In development and in `vite preview`, the plugin in [vite/duckdbAssets.ts](vite/duckdbAssets.ts) serves the same paths, taking the four engine files from `node_modules/@duckdb/duckdb-wasm/dist` for the installed version only and the extensions from `.cache/duckdb-extensions`.

After every build [scripts/check-dist.mjs](scripts/check-dist.mjs) checks that `dist/` holds no `.wasm` file, no DuckDB worker and no file over 25 MiB, that it holds `_routes.json`, and that no built file names a CDN or any external host other than Google Fonts, apart from an allow-list of URLs that appear as text inside bundled libraries and are never requested.

### Extensions

DuckDB loads its `parquet` and `json` extensions at run time. Right after the engine starts, the application runs the statements in `extensionRepositoryStatements`, which point `custom_extension_repository` and `autoinstall_extension_repository` at `<origin>/assets/duckdb-extensions` and turn off community extensions, so every extension comes from the same origin. The repository follows the layout DuckDB expects, `v<engine>/<platform>/<name>.duckdb_extension.wasm`, for the `wasm_mvp` and `wasm_eh` platforms.

The extensions to host, their source and their sha256 are pinned in the `duckdb_extensions` section of [config/versions.yaml](../../config/versions.yaml). [scripts/fetch-duckdb-extensions.mjs](scripts/fetch-duckdb-extensions.mjs), run as `pnpm --dir packages/web extensions` and before `dev`, `test` and `preview`, makes sure each file is present in `.cache/duckdb-extensions` with its pinned hash. It downloads a missing or altered file from the pinned source, fails when the download does not match the pin, and makes no request when the cache is valid. With `--out <dir>` it writes the same layout to another directory, which the deploy workflow uploads to the bucket.

### Tests

The version of `@duckdb/duckdb-wasm` is pinned in [config/versions.yaml](../../config/versions.yaml) with the DuckDB Python version of the ingest package. `test/crossread.test.ts` reads [tests/fixtures/crossread.parquet](../../tests/fixtures/crossread.parquet), written by the ingest package, and requires every type and value to match, and `test/versions.test.ts` checks that `package.json` agrees with the pins. `test/duckdbExtensions.test.ts` opens the same file with the parquet extension taken from a local repository and requires that the engine asked that repository for exactly one file and nothing else. Both tests run DuckDB-WASM in Node with the repository served from `.cache/duckdb-extensions` by a small server in a child process ([test/support/](test/support/)), since the Node build of DuckDB-WASM blocks the event loop while it loads an extension, and both give DuckDB a temporary home directory, since that build otherwise keeps a copy of each extension under `~/.duckdb`. `test/assetsFunction.test.ts` covers the Pages Function with a fake bucket and `test/duckdbAssets.test.ts` covers the engine URLs and the development server.
