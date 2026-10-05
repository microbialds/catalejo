# @catalejo/web

The static application of Catalejo Genómico, written in TypeScript with React and Vite. It reads a release directly in the browser through DuckDB-WASM, following the release layout in [docs/data-contract.md](../../docs/data-contract.md) §6 and the pages in [docs/requirements.md](../../docs/requirements.md). It renders the shell, with the wordmark, the navigation, the set bar and the footer, together with the Collection page and the Genomes page, which read the release served at `/data/`, while every other page shows a placeholder until the milestone that builds it.

## Installation

The package needs Node 24 (see `.node-version` at the repository root) and pnpm. From the repository root, run the following.

```
pnpm --dir packages/web install
pnpm --dir packages/web exec playwright install chromium
```

The second command installs the Chromium build that the end-to-end tests use. On Linux it takes `--with-deps`, which also installs the system libraries Chromium needs.

```
pnpm --dir packages/web exec playwright install --with-deps chromium
```

The first `dev`, `test` or `preview` needs network access, because it downloads the pinned DuckDB extensions from extensions.duckdb.org into `.cache/duckdb-extensions/`, and later runs use that cache once its files pass the hash check (see Extensions below). The B612 and B612 Mono fonts are loaded from Google Fonts when the page opens, so the interface falls back to a system face without network access.

## Scripts

Each script runs as `pnpm --dir packages/web <script>` from the repository root.

| Script          | What it does                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `dev`           | Starts the Vite development server on port 5173, after running `generate` and `extensions`       |
| `build`         | Type checks and builds into `dist/` after running `generate`, then runs `scripts/check-dist.mjs` |
| `test`          | Runs the Vitest tests after running `generate` and `extensions`                                  |
| `e2e`           | Runs the Playwright tests in `e2e/` against `releases/synth`                                     |
| `lint`          | Runs ESLint and the Prettier check                                                               |
| `typecheck`     | Runs `tsc -b` after running `generate`                                                           |
| `generate`      | Writes `src/generated/` and `public/favicon.svg` from the files in `config/`                     |
| `extensions`    | Fills `.cache/duckdb-extensions/` with the pinned DuckDB extensions                              |
| `preview`       | Serves the built `dist/` on port 4173, after running `extensions`                                |
| `upload-assets` | Uploads the DuckDB-WASM engine and extension files to the R2 bucket with rclone, for maintainers |

The end-to-end tests need the synthetic release in `releases/synth`, which the sequence in [packages/ingest/README.md](../ingest/README.md) builds. With the environment variable `CI` set, as in CI, `e2e` builds `dist/` and serves it with `vite preview` on port 5173, so that the tests see the bundle that is deployed. Otherwise it reuses a server already running on port 5173, such as `pnpm --dir packages/web dev`, or starts the development server itself. The tests run in Chromium at widths of 1440 and 1024 pixels, and at 390 pixels for the specs of the shell, the Collection page, the Genomes page and the table view.

`upload-assets` uploads the four engine files and the extension repository in `.cache/duckdb-extensions/` to `r2:catalejo-releases/assets/`, where the Function described under DuckDB-WASM serves them. `--remote` and `--bucket` change the rclone remote and the bucket, as do the environment variables `CATALEJO_R2_REMOTE` and `CATALEJO_R2_BUCKET`, with the options taking precedence, and `--dry-run` prints the rclone commands without running them, which needs no rclone. A file already in the bucket with the same checksum is not sent again.

```
pnpm --dir packages/web run upload-assets --dry-run
```

## Development server and release data

`pnpm --dir packages/web dev` serves the application at `http://localhost:5173` and the release files under `/data/`, the same origin path the deployed application uses. The plugin in [vite/releaseData.ts](vite/releaseData.ts) serves `releases/synth` at the repository root by default, and the environment variable `CATALEJO_RELEASE_DIR` selects another release directory, with a relative value taken from the directory pnpm was invoked in.

```
CATALEJO_RELEASE_DIR=<release directory> pnpm --dir packages/web dev
```

The plugin serves two kinds of path. `/data/manifest.json` is the manifest of the release directory, sent with `Cache-Control: no-cache`, and `/data/r/<release_id>/<path>` is a file of that release, sent as immutable, where `<release_id>` must be the `release_id` named in that manifest, which the plugin reads again whenever the file changes. A path naming another release answers 404 with the header `X-Catalejo-Release: stale`, any other path under `/data/` answers 404, and a missing release directory also answers 404 without stopping the server. The plugin answers HEAD requests and byte ranges (206 with `Content-Range`, or 416 when a range cannot be satisfied) with `Content-Length` and `Accept-Ranges`, which DuckDB-WASM needs to read Parquet files in parts, and the same handler serves `vite preview`.

The release must be built before the pages show any data, with the sequence in [packages/ingest/README.md](../ingest/README.md). Because the browser keeps immutable files under the same URL, reload the page without the cache (Cmd+Shift+R or Ctrl+Shift+R) after rebuilding the release under the same `release_id`.

The pages read `/data/manifest.json` once at startup, through `src/data/manifest.ts`, to learn the release identifier, the genome count, the species and the products the release contains, and a release whose `schema_version` lies outside the range the application supports shows the mismatch and nothing else. Every other file is read at `/data/r/<release_id>/<path>` with the `release_id` of that manifest, through `src/data/release.ts`. When a read fails, `src/data/releaseChange.ts` asks the server whether the release is still current, and when it is not, the application asks the reader to reload.

In production the Pages Function in [functions/data/[[path]].ts](functions/data/[[path]].ts) answers `/data/*` from the R2 bucket bound as `RELEASES`. It reads the pointer file `releases/current.json`, or `releases/<group_id>/current.json` when the environment variable `CATALEJO_GROUP` names a group, and serves `/data/manifest.json` from the release the pointer names with `Cache-Control: no-cache` and the object's ETag. It serves `/data/r/<release_id>/<path>` from `releases/<release_id>/<path>`, or `releases/<release_id>/<group_id>/<path>` for a group, as immutable when `<release_id>` is the pointer's release, and with 404 and `X-Catalejo-Release: stale` for any other release, while any other `/data/` path answers 404 without reading the bucket. Every key is built under the instance's prefix from checked path segments, so an instance never reaches another release or another group's files. The parsed pointer is kept for 60 seconds, and a request for a release other than the cached one reads the pointer again before it is called stale, since isolates refresh their pointers at different times. The Function answers HEAD and a single byte range with the same headers as the development server, and a GET costs one R2 operation, because the range and `If-None-Match` travel in the same `get()` call. A range that starts at or past the end of a file answers 416, a matching `If-None-Match` answers 304, a missing pointer or binding answers 503, and a method other than GET and HEAD answers 405. `test/dataFunction.test.ts` covers the Function with a fake bucket.

## Configuration and design tokens

Colors come from [config/palette.yaml](../../config/palette.yaml) and the typography, color roles, spacing, layout and shape from [config/design-tokens.yaml](../../config/design-tokens.yaml). [scripts/generate.ts](scripts/generate.ts) compiles both into `src/generated/palette.ts`, `src/generated/tokens.ts` and `src/generated/tokens.css`, which are committed and must not be edited by hand. `test/generated.test.ts` fails when the committed files differ from a fresh generation, and CI also checks that the generated directory is unchanged after the tests. After changing either YAML file, run `pnpm --dir packages/web generate` and commit the result.

`test/palette.test.ts` scans `src/` and `index.html` for hex colors, color functions and named colors, using the detector in `test/guards/colorLiterals.ts`, so every color reaches a component through the generated palette.

The interface is set in B612, with B612 Mono for identifiers, counts and numerals, both loaded from Google Fonts through the stylesheet link in `index.html`, which `test/generated.test.ts` compares with the design tokens. `test/design.test.ts` uses the detector in `test/guards/designRules.ts` to fail when `src/` uses the serif face, a weight other than 400 and 700, an uppercase label, or an opacity below 1, since every mark is drawn in a palette color as is. Links are ink and follow the two tiers of requirements §5.4, underlined at rest in running text and on hover and focus in tables, chips, pills, counters and the facet rail through the `link-quiet` utility of `src/index.css`. The tier of the navigation items, the footer links and the text controls drawn as links is set in one place, `CHROME_LINK` in `src/linkTier.ts`.

## Strings

Every user-visible string lives in [src/strings.ts](src/strings.ts), keyed by identifier, so that a translation is one more module with the same keys. `test/strings.test.ts` uses the detector in `test/guards/literalText.ts`, built on the TypeScript compiler, to fail when a component contains JSX text, a literal string rendered as a child, or a literal value in a visible attribute such as `title`, `aria-label`, `placeholder` or `alt`.

## DuckDB-WASM

The DuckDB-WASM engine files are served from the application's own origin and never from a CDN, but they are not part of the build, because each `.wasm` file is larger than the 25 MiB per file that Cloudflare Pages accepts. [src/data/engineAssets.ts](src/data/engineAssets.ts) builds every engine URL from `/assets/duckdb-wasm/<version>/`, where the version is that of the installed `@duckdb/duckdb-wasm`, injected at build time through Vite's `define` as `__DUCKDB_WASM_VERSION__`. Only the mvp and eh bundles are offered to DuckDB, so the directory holds four files, `duckdb-mvp.wasm`, `duckdb-eh.wasm`, `duckdb-browser-mvp.worker.js` and `duckdb-browser-eh.worker.js`. The threaded bundle is left out since the application does not use cross-origin isolation. [src/data/duckdb.ts](src/data/duckdb.ts) creates the database on first use and [src/data/database.ts](src/data/database.ts) loads it lazily, so the engine is fetched only when a page first needs a table.

In production the Pages Function in [functions/assets/[[path]].ts](functions/assets/[[path]].ts) answers `/assets/duckdb-wasm/*` and `/assets/duckdb-extensions/*` from the keys under `assets/` in the R2 bucket bound as `RELEASES`, which the maintainer uploads with `pnpm --dir packages/web run upload-assets` (the deploy workflow takes this over in milestone 5). It sends `application/wasm` for `.wasm` files and `text/javascript` for the workers, marks every file immutable for a year, answers `If-None-Match` with 304, and answers 503 when the binding is missing. [public/\_routes.json](public/_routes.json) limits the Function to those two prefixes, together with `/data/*` for the release Function, so the application's own files under `/assets/` stay static. The types the Function needs are declared in [functions/types.ts](functions/types.ts), and `functions/tsconfig.json` type checks them against the Web Worker library. In development and in `vite preview`, the plugin in [vite/duckdbAssets.ts](vite/duckdbAssets.ts) serves the same paths, taking the four engine files from `node_modules/@duckdb/duckdb-wasm/dist` for the installed version only and the extensions from `.cache/duckdb-extensions`.

After every build [scripts/check-dist.mjs](scripts/check-dist.mjs) checks that `dist/` holds no `.wasm` file, no DuckDB worker and no file over 25 MiB, that it holds `_routes.json`, and that no built file names a CDN or any external host other than Google Fonts, apart from an allow-list of URLs that appear as text inside bundled libraries and are never requested.

### Extensions

DuckDB loads its `parquet` and `json` extensions at run time. Right after the engine starts, the application runs the statements in `extensionRepositoryStatements`, which point `custom_extension_repository` and `autoinstall_extension_repository` at `<origin>/assets/duckdb-extensions` and turn off community extensions, so every extension comes from the same origin. The repository follows the layout DuckDB expects, `v<engine>/<platform>/<name>.duckdb_extension.wasm`, for the `wasm_mvp` and `wasm_eh` platforms.

The extensions to host, their source and their sha256 are pinned in the `duckdb_extensions` section of [config/versions.yaml](../../config/versions.yaml). [scripts/fetch-duckdb-extensions.mjs](scripts/fetch-duckdb-extensions.mjs), run as `pnpm --dir packages/web extensions` and before `dev`, `test` and `preview`, makes sure each file is present in `.cache/duckdb-extensions` with its pinned hash. It downloads a missing or altered file from the pinned source, fails when the download does not match the pin, and makes no request when the cache is valid. With `--out <dir>` it writes the same layout to another directory. `pnpm --dir packages/web run upload-assets` uploads the cache directory itself to the bucket, together with the engine files.

### Tests

The version of `@duckdb/duckdb-wasm` is pinned in [config/versions.yaml](../../config/versions.yaml) with the DuckDB Python version of the ingest package. `test/crossread.test.ts` reads [tests/fixtures/crossread.parquet](../../tests/fixtures/crossread.parquet), written by the ingest package, and requires every type and value to match, and `test/versions.test.ts` checks that `package.json` agrees with the pins. `test/duckdbExtensions.test.ts` opens the same file with the parquet extension taken from a local repository and requires that the engine asked that repository for exactly one file and nothing else. Both tests run DuckDB-WASM in Node with the repository served from `.cache/duckdb-extensions` by a small server in a child process ([test/support/](test/support/)), since the Node build of DuckDB-WASM blocks the event loop while it loads an extension, and both give DuckDB a temporary home directory, since that build otherwise keeps a copy of each extension under `~/.duckdb`. `test/assetsFunction.test.ts` covers the Pages Function with a fake bucket and `test/duckdbAssets.test.ts` covers the engine URLs and the development server.
