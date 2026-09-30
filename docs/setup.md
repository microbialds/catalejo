# Setup

How to create the Catalejo repository, install the toolchain, configure Claude Code, and run the first session. Steps marked *maintainer* are done once by the maintaining group; the rest apply to anyone working on the code.

## 1. Prerequisites

| Tool | Version | Install |
|---|---|---|
| git | 2.40 or later | system package |
| GitHub CLI (`gh`) | current | https://cli.github.com |
| uv | current | https://docs.astral.sh/uv/ (manages Python 3.13 itself) |
| Node | 24 LTS | fnm or nvm; `fnm install 24` |
| pnpm | current | `corepack enable pnpm` after Node is installed |
| Claude Code | current | https://docs.claude.com/en/docs/claude-code/overview |
| Playwright browsers | current | installed by `pnpm --dir packages/web exec playwright install chromium` after milestone 1 |

Python 3.13 is installed by uv on first `uv sync`; no system Python is required.

## 2. Create the repository (maintainer)

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
gh repo create [ORGANIZATION]/catalejo --private --source . --push
```

On GitHub, protect `main` (Settings, Branches, add rule for `main`): require a pull request before merging, require status checks to pass once CI exists, and do not allow force pushes. Do not install the Claude GitHub App or the Claude Code GitHub Action on this repository.

## 3. Claude Code configuration

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

Both settings belong in `~/.claude/settings.json`, your user file, so that model and billing choices stay personal:

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

## 4. Toolchain check

After milestone 0 has created the packages, the following commands must all succeed from the repository root.

```
uv sync --project packages/ingest
uv run --project packages/ingest catalejo --help
pnpm --dir packages/web install
pnpm --dir packages/web typecheck
```

## 5. Running a session

1. Open a terminal in the repository and start Claude Code with the model.
2. Press Shift+Tab until plan mode is active.
3. Type `Run milestone <N> as specified in dev/build-plan.md.`
4. Read the plan, correct it, approve it.
5. The session runs its own build, critic and fix loop and opens the pull request with the final critic report. Read the report and the "Open points" section, then review the pull request on GitHub.
6. Merge, tag if the milestone calls for it, check `/status`, and close the session with `/clear` before starting the next milestone.

Do not carry a session across milestones. The documents are the memory of the project; the conversation is not.

## 6. Local data

Before milestone 0, place a small real mgap results directory (a few genomes covering the tools in the contract, including one run with MOB-suite and one without) at `data/mgap-example/`. It is ignored by git and is the reference from which the parsers and the synthetic generator take the file layout.

Synthetic data and local releases live under `data/`, `catalog/` and `releases/`, all ignored by git. To produce the synthetic release used by tests and by the critic:

```
uv run --project packages/ingest catalejo synth --species 10 --genomes 100 --out data/synth
uv run --project packages/ingest catalejo metadata init --mgap data/synth --out data/synth-metadata.csv
uv run --project packages/ingest catalejo ingest --mgap data/synth --metadata data/synth-metadata.csv --catalog catalog/synth.duckdb
uv run --project packages/ingest catalejo release build --catalog catalog/synth.duckdb --out releases/synth
pnpm --dir packages/web dev
```

The exact flags are defined by the command's help once milestone 1 is complete; the sequence above is the intended shape.

## 7. Deployment

Hosting and deployment are described in `docs/requirements.md` §10 and §11. The account-level procedure (Cloudflare account, Pages project, R2 bucket, Access policy, secrets) is an internal document held by the maintaining group.