#!/usr/bin/env bash
# keystack-export-track-a.sh — generates ~/.claude/track-a-paths.txt (one local_path per line)
# for every Track A project in the keystack registry. FORGE wave1 §6 / story 6 of
# .ai-codex/specs/spec-forge-wave1.md in the keystack repo.
#
# Consumed by ~/.claude/hooks/phase0-gate.sh (PreToolUse gate hook) — that hook must stay
# sub-50ms, so it only ever reads this plain-text file + stat()s architecture.md; it never
# touches sqlite3 itself. This script is the one and only place sqlite3 is invoked for that
# purpose, run from the nightly LaunchAgent (dev.nzt108.keystack-scan.plist) right after
# keystack-scan.sh --all --fast, and can also be run by hand any time track/local_path changes.
#
# Same style/conventions as the sibling keystack-scan.sh / keystack-export-table.sh scripts:
# deterministic bash + sqlite3, NO LLM.
#
# Env:
#   KEYSTACK_HOME     — DB directory (default ~/.keystack), same var the Node MCP server uses.
#   TRACK_A_FILE      — output file (default ~/.claude/track-a-paths.txt). Test-only seam.
#
# Exit code: 0 on success. Non-zero only when the DB itself is unusable — an empty Track A
# result set (0 rows) is a valid, handled outcome (writes an empty file; the gate hook's
# "file absent OR no match" fail-open path covers that too).

set -o pipefail   # deliberately NOT -e/-u — see keystack-scan.sh for the bash 3.2 rationale

KEYSTACK_HOME="${KEYSTACK_HOME:-$HOME/.keystack}"
DB="$KEYSTACK_HOME/keystack.db"
TRACK_A_FILE="${TRACK_A_FILE:-$HOME/.claude/track-a-paths.txt}"

if [ ! -f "$DB" ]; then
  echo "keystack-export-track-a.sh: no DB at $DB — run the keystack MCP server once first (it creates/migrates it)" >&2
  exit 1
fi

TMP_FILE="${TRACK_A_FILE}.tmp.$$"
sqlite3 "$DB" "SELECT local_path FROM projects WHERE track = 'A' AND local_path != '' ORDER BY slug;" > "$TMP_FILE"
mv "$TMP_FILE" "$TRACK_A_FILE"

echo "keystack-export-track-a.sh: wrote $(wc -l < "$TRACK_A_FILE" | tr -d ' ') Track A path(s) to $TRACK_A_FILE"
