# Setup

How to create the Catalejo repository, install the toolchain, configure Claude Code, and run the first session. Steps marked *maintainer* are done once by the maintaining group; the rest apply to anyone working on the code.

## 1. Prerequisites

### Run locally

These tools are enough to build the synthetic release, run the application and run the tests.

| Tool | Version | Source of the version |
|---|---|---|
| git | 2.40 or later | system package |
| uv | current | https://docs.astral.sh/uv/, which installs Python 3.13 itself |
| Node | 24 | `.node-version` at the repository root |
| pnpm | 10.10.0 | the `packageManager` field of `packages/web/package.json` |
| Playwright Chromium | the build of `@playwright/test` in `packages/web` | installed after the web dependencies |

Python 3.13 is installed by uv on the first `uv sync`, so no system Python is needed. On macOS with Homebrew, the following installs uv and fnm, the Node version manager that reads `.node-version`, then Node 24, and enables pnpm through corepack, which ships with Node.

```
brew install uv fnm
fnm install 24
corepack enable pnpm
```

On Linux, uv comes from its installer script.

```
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Node 24 comes from fnm as above, or from nvm with the following command, after which `corepack enable pnpm` is run as on macOS.

```
nvm install 24
```

So that fnm switches to Node 24 whenever a terminal enters the repository, add the following line to `~/.zshrc` and open a new terminal.

```
eval "$(fnm env --use-on-cd --shell zsh)"
```

The Chromium build that the end-to-end tests use is installed once the web dependencies are (§5), from the repository root.

```
pnpm --dir packages/web exec playwright install chromium
```

On Linux the same command takes `--with-deps`, which also installs the system libraries Chromium needs.

```
pnpm --dir packages/web exec playwright install --with-deps chromium
```

The first run needs network access, since uv downloads Python 3.13 and the Python packages, pnpm downloads the npm packages, and the first `dev`, `test` or `preview` of the web package fetches the pinned DuckDB extensions from extensions.duckdb.org. The dependencies, the synthetic data and the release take about 1 GB of disk, and the Playwright browser about 0.5 GB more.

### Maintainers and Claude Code

These tools are needed only to open pull requests, run Claude Code sessions, upload files to the bucket and deploy.

| Tool | Version | Install |
|---|---|---|
| GitHub CLI (`gh`) | current | https://cli.github.com |
| Claude Code | current | https://docs.claude.com/en/docs/claude-code/overview |
| Playwright MCP server | current | added to Claude Code as in §4 |
| rclone | current | Homebrew, as below |
| wrangler | 4 | not installed, run as `npx wrangler@4` |

```
brew install gh rclone
```

rclone carries the uploads of `pnpm --dir packages/web run upload-assets` to the R2 bucket, and wrangler, which npx fetches on each use, deploys to Cloudflare Pages.

## 2. Clone the repository

Everyone except the maintainer who created the repository starts from a clone. Every command in this document runs from the repository root.

```
git clone https://github.com/microbialds/catalejo.git
cd catalejo
```

## 3. Create the repository (maintainer)

The maintainer did this once, when the repository was created, and it is kept here as a record.

```
mkdir catalejo && cd catalejo
git init -b main
git config user.name "[YOUR NAME]"
git config user.email "[YOUR EMAIL]"
```

Copy the bootstrap files into the directory (`CLAUDE.md`, `.claude/`, `docs/`, `.gitignore`, `LICENSE`, `CITATION.cff`, `.env.example`) and the internal `dev/` directory. Make the hooks executable and confirm `dev/` is ignored before the first commit.

```
chmod +x .claude/hooks/*.sh
git status --ignored | grep dev/
```

Authenticate the GitHub CLI once, so that Claude Code can open pull requests under your account.

```
gh auth login
```

Edit `LICENSE` and `CITATION.cff` to replace the placeholders. Then make the first commit yourself.

```
git add -A
git commit -m "Bootstrap repository with specification, Claude Code configuration and license"
gh repo create [ORGANIZATION]/catalejo --public --source . --push
```

On GitHub, protect `main` (Settings, Branches, add rule for `main`) so that merging requires a pull request and passing status checks once CI exists, and force pushes are not allowed. Do not install the Claude GitHub App or the Claude Code GitHub Action on this repository.

The repository is public. Actions minutes are unlimited on public repositories; secrets are not available to workflows triggered from forks.


## 4. Claude Code configuration

The repository ships `.claude/settings.json` (shared permissions and hooks) and `.claude/agents/` (subagents). Personal overrides go in `.claude/settings.local.json`, which is ignored.

Model. Start sessions with the model you intend to use for the whole session; the subagents inherit it. The `opus` alias resolves to Opus 5.5 on Claude Code v2.1.280 or later.

```
claude --model opus
```

Inside a session `/model` shows and changes the current model, and `/status` shows the model actually in use, which is worth checking at the end of every session.

Advisor. Claude Code can consult a second, stronger model at decision points (before committing to an approach, when an error recurs, before declaring a task done). Set Fable 5.1 as the advisor once; the choice is saved in your user settings, not in the repository.

```
/advisor fable
```

Flagged requests. Fable 5.1 and Opus 5.5 run safety classifiers that flag biology content, and a repository about resistance determinants can trigger them, sometimes on the first request of a session. By default Claude Code then switches the session to Opus 5 without asking. To be asked instead, run `/config` and turn off "Switch models when a message is flagged" (this writes `switchModelsOnFlag: false` to your user settings). Record the model that served each session in the development log.

Both settings belong in `~/.claude/settings.json`, your user file, so that model and billing choices stay personal, as follows.

```json
{
  "model": "opus",
  "advisorModel": "fable",
  "switchModelsOnFlag": false
}
```

Browser for the critic. The critic subagent uses the Playwright MCP server. Add it once per machine.

```
claude mcp add playwright -- npx @playwright/mcp@latest
```

Verify with `claude mcp list` that `playwright` is listed, and that the tool names in `.claude/agents/critic.md` match those the server exposes (`claude mcp get playwright` or the server's README); adjust the `tools` line in the agent file if the names differ.

Co-author trailer. `.claude/settings.json` sets `includeCoAuthoredBy` to `false`. If the key is rejected by your Claude Code version, look up the current name of the setting that disables the co-author trailer and use that.

## 5. Toolchain check

The following commands must all succeed from the repository root.

```
uv sync --project packages/ingest
uv run --project packages/ingest catalejo --help
pnpm --dir packages/web install
pnpm --dir packages/web typecheck
```

## 6. Local data

The synthetic data and its catalog live under `data/`, with the catalog in `data/catalog/`, and the releases under `releases/`, both ignored by git. The following sequence builds the synthetic release that the application, the end-to-end tests and the critic read, and starts the development server on it. Its `catalejo` lines are copied from the "Synthetic release" step of `.github/workflows/ci.yml`, so a local build follows the same steps as CI.

```
uv sync --project packages/ingest
catalejo() { uv run --project packages/ingest catalejo "$@"; }
catalejo synth --species 10 --genomes 100 --out data/synth
catalejo metadata init --mgap data/synth/results --existing data/synth/metadata.csv --out data/synth/metadata.csv
catalejo ingest --mgap data/synth/results --metadata data/synth/metadata.csv --catalog data/catalog/synth.duckdb
catalejo tombstones ingest --file data/synth/tombstones.csv --catalog data/catalog/synth.duckdb
catalejo groups ingest --groups data/synth/groups.csv --members data/synth/genome_groups.csv --catalog data/catalog/synth.duckdb
catalejo sets ingest --file data/synth/sets.csv --catalog data/catalog/synth.duckdb
catalejo release check --catalog data/catalog/synth.duckdb --metadata data/synth/metadata.csv --mgap data/synth/results
catalejo release build --catalog data/catalog/synth.duckdb --out releases/synth
catalejo release check --catalog data/catalog/synth.duckdb --release releases/synth
pnpm --dir packages/web install
pnpm --dir packages/web dev
```

The line that starts with `catalejo()` defines a shell function in zsh or bash, so that `catalejo` runs the command through uv for as long as the terminal stays open. The application is then at http://localhost:5173. Release files are cached by the browser as immutable, so after rebuilding the release under the same identifier, reload the page without the cache (Cmd+Shift+R on macOS, Ctrl+Shift+R elsewhere). [packages/ingest/README.md](../packages/ingest/README.md) describes what each command does.

The maintainer also keeps a small real mgap results directory at `data/mgap-example/`, a few genomes covering the tools in the contract, with one run that includes MOB-suite and one that does not, and a nanopore run at `data/ont_example/`. They are the reference from which the parsers and the synthetic generator take the file layout, they stay on the maintainer's machine, and the tests that read them are skipped when they are absent, so nobody else needs them.

## 7. Running a session

1. Open a terminal in the repository and start Claude Code with the model.
2. Press Shift+Tab until plan mode is active.
3. Type `Run milestone <N> as specified in dev/build-plan.md.`
4. Read the plan, correct it, approve it.
5. The session runs its own build, critic and fix loop and opens the pull request with the final critic report. Read the report and the "Open points" section, then review the pull request on GitHub.
6. Merge, tag if the milestone calls for it, check `/status`, and close the session with `/clear` before starting the next milestone.

Do not carry a session across milestones. The documents are the memory of the project; the conversation is not.

## 8. Deployment

Hosting and deployment are described in `docs/requirements.md` §10 and §11. The procedure, from the one-time setup of the Cloudflare account to publishing releases and adding group instances, is [docs/deployment.md](deployment.md), read from top to bottom.