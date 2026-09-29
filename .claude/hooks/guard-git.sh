#!/usr/bin/env bash
# PreToolUse hook for Bash. Reads the tool call as JSON on stdin and blocks
# git operations that the maintainer reserves for themselves. Exit code 2
# blocks the command and returns the message to Claude.
input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)
[ -z "$cmd" ] && exit 0
block() { echo "Blocked by .claude/hooks/guard-git.sh: $1. This operation is reserved for the maintainer (see CLAUDE.md, Git)." >&2; exit 2; }
# A push whose own arguments (before any && ; |) name main; a later "gh pr create --base main" is fine.
if printf '%s' "$cmd" | grep -qE 'git push[^&|;]*(\s|:)main(\s|$)'; then block "push to main"; fi
case "$cmd" in
  *"git push"*"--force"*|*"git push"*" -f"*) block "force push" ;;
  *"git tag"*)                    block "tag creation" ;;
  *"git rebase"*)                 block "rebase" ;;
  *"git reset --hard"*)           block "hard reset" ;;
  *"git branch -D"*|*"git branch -d"*) block "branch deletion" ;;
  *"git config"*)                 block "git configuration change" ;;
  *"gh pr merge"*)                block "pull request merge" ;;
  *"git commit"*"Co-Authored-By"*) block "co-author trailer in commit message" ;;
esac
exit 0