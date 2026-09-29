#!/usr/bin/env bash
# PreToolUse hook for Edit/Write. Blocks edits to the specification documents,
# which only the maintainer changes, through the contract-change procedure in
# dev/build-plan.md. To lift the block for one session, the maintainer exports
# CATALEJO_ALLOW_SPEC_EDITS=1 before starting Claude Code.
[ "${CATALEJO_ALLOW_SPEC_EDITS:-0}" = "1" ] && exit 0
input=$(cat)
file=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("file_path") or d.get("path") or "")' 2>/dev/null)
[ -z "$file" ] && exit 0
case "$file" in
  */docs/data-contract.md|*/docs/requirements.md|*/docs/critic-checklist.md|docs/data-contract.md|docs/requirements.md|docs/critic-checklist.md)
    echo "Blocked by .claude/hooks/guard-docs.sh: '$file' is a specification document. Do not edit it. Stop, describe the gap and the proposed wording, and wait for the maintainer (CLAUDE.md, Autonomy and escalation)." >&2
    exit 2 ;;
esac
exit 0