#!/usr/bin/env bash
# PreToolUse hook for Bash. Reads the tool call as JSON on stdin and blocks
# git operations that the maintainer reserves for themselves. Exit code 2
# blocks the command and returns the message to Claude.
input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)
[ -z "$cmd" ] && exit 0
block() { echo "Blocked by .claude/hooks/guard-git.sh: $1. This operation is reserved for the maintainer (see CLAUDE.md, Git)." >&2; exit 2; }
case "$cmd" in
  *"git push"*"main"*)            block "push to main" ;;
  *"git push"*"--force"*|*"git push"*" -f"*) block "force push" ;;
  *"git tag"*)                    block "tag creation" ;;
  *"git rebase"*)                 block "rebase" ;;
  *"git reset --hard"*)           block "hard reset" ;;
  *"git branch -D"*|*"git branch -d"*) block "branch deletion" ;;
  *"git config"*)                 block "git configuration change" ;;
  *"gh pr merge"*)                block "pull request merge" ;;
  *"git commit"*"Co-Authored-By"*|*"git commit"*"Claude"*) block "commit message mentioning Claude" ;;
esac
exit 0
