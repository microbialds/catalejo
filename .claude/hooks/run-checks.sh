#!/usr/bin/env bash
# PostToolUse hook for Edit/Write. Runs the linter for the package that was
# edited. Failures are reported to Claude (exit 2) so they are fixed in the
# same turn. Skips files outside the two packages and skips silently until the
# package exists (milestone 0 creates it). Type checks run with the tests.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
input=$(cat)
file=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("file_path") or d.get("path") or "")' 2>/dev/null)
[ -z "$file" ] && exit 0
case "$file" in
  *packages/ingest/*.py)
    [ -f packages/ingest/pyproject.toml ] || exit 0
    out=$(uv run --project packages/ingest ruff check "$file" 2>&1) || { echo "ruff: $out" >&2; exit 2; }
    ;;
  *packages/web/src/*.ts|*packages/web/src/*.tsx|*packages/web/functions/*.ts)
    [ -f packages/web/package.json ] && [ -d packages/web/node_modules ] || exit 0
    out=$(pnpm --dir packages/web exec eslint "$file" 2>&1) || { echo "eslint: $out" >&2; exit 2; }
    ;;
esac
exit 0