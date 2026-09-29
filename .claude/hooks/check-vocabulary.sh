#!/usr/bin/env bash
# PostToolUse hook for Edit/Write. Rejects the words the vocabulary forbids
# in source, strings and documentation. Exit code 2 reports to Claude.
input=$(cat)
file=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("file_path") or d.get("path") or "")' 2>/dev/null)
[ -z "$file" ] || [ ! -f "$file" ] && exit 0
case "$file" in
  */docs/data-contract.md|*/docs/requirements.md|*/CLAUDE.md|*/.claude/*) exit 0 ;;
esac
if grep -n -i -E '\bcohorts?\b' "$file" >/dev/null 2>&1; then
  echo "Vocabulary: '$file' contains 'cohort'. Use 'genome set' (CLAUDE.md, Vocabulary)." >&2
  exit 2
fi
case "$file" in
  *packages/web/src/*)
    if grep -n -i -E '\batlas\b' "$file" >/dev/null 2>&1; then
      echo "Vocabulary: '$file' contains 'atlas'. Use 'embedding map' or 'Embeddings' (CLAUDE.md, Vocabulary)." >&2
      exit 2
    fi ;;
esac
exit 0
