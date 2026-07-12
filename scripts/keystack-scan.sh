#!/usr/bin/env bash
# keystack-scan.sh — deterministic dev-state scanner for the keystack registry.
# NO LLM. Talks to ~/.keystack/keystack.db (or $KEYSTACK_HOME/keystack.db) directly via the
# sqlite3 CLI, matching the schema in keystack's src/db/schema.ts (FORGE wave1 contract, §2.4
# of .ai-codex/specs/spec-forge-wave1.md in the keystack repo).
#
# Usage:
#   keystack-scan.sh <local-path>            scan one project, found in the DB by local_path
#   keystack-scan.sh --all                   scan every project with a non-empty local_path
#   keystack-scan.sh <local-path> --fast      skip running the test suite (tests_green forced 0
#   keystack-scan.sh --all --fast             unless a prior run already marked it green*)
#
# * tests_green is NOT re-read from the DB and preserved on --fast — it is simply left at 0 for
#   any project whose test suite wasn't actually run this pass. --fast is for the nightly cron
#   (LaunchAgent) where a fast, conservative signal beats a stale "green".
#
# Env:
#   KEYSTACK_HOME          — DB directory (default: ~/.keystack), same var the Node MCP server uses.
#   KEYSTACK_SCAN_TIMEOUT  — seconds before a test run is killed (default: 120). Test-only override;
#                            production runs should leave this at the default.
#
# Exit code: 0 even when individual projects error out under --all — those are collected into the
# final summary printed to stdout. A single project's failure must never abort the whole sweep.

set -o pipefail   # deliberately NOT -e: one project blowing up must not kill --all
# NOT -u either: macOS ships bash 3.2 (no homebrew bash on PATH is assumed), where
# `"${arr[@]}"` on an empty array raises "unbound variable" under `set -u` — a known
# 3.2-era bug, fixed in bash 4.4+. This script must run under whatever bash `/usr/bin/env`
# resolves to, so it targets 3.2 compatibility rather than assuming a newer bash.

KEYSTACK_HOME="${KEYSTACK_HOME:-$HOME/.keystack}"
DB="$KEYSTACK_HOME/keystack.db"
TIMEOUT_SECS="${KEYSTACK_SCAN_TIMEOUT:-120}"

# ---- arg parsing -------------------------------------------------------------------------------

FAST=0
ALL=0
TARGET=""
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --all) ALL=1 ;;
    *) TARGET="$arg" ;;
  esac
done

if [ "$ALL" -eq 0 ] && [ -z "$TARGET" ]; then
  echo "usage: keystack-scan.sh <local-path> | --all [--fast]" >&2
  exit 1
fi

if [ ! -f "$DB" ]; then
  echo "keystack-scan.sh: no DB at $DB — run the keystack MCP server once first (it creates/migrates it)" >&2
  exit 1
fi

# ---- small helpers ------------------------------------------------------------------------------

sql() { sqlite3 -separator '|' "$DB" "$@"; }
sql_escape() { printf '%s' "$1" | sed "s/'/''/g"; }
now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

file_size() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1" 2>/dev/null || echo 0
}

file_mtime_iso() {
  local f="$1" epoch
  epoch=$(stat -f%m "$f" 2>/dev/null) || epoch=$(stat -c%Y "$f" 2>/dev/null) || epoch=0
  date -u -r "$epoch" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "@$epoch" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo ""
}

# `timeout`/`gtimeout` aren't guaranteed on macOS (no coreutils by default) — fall back to a perl
# fork/alarm/kill wrapper that works anywhere perl does (ships with macOS + every Linux).
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
    return $?
  fi
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
    return $?
  fi
  perl - "$secs" "$@" <<'PERL_TIMEOUT'
use strict;
use warnings;

my $secs = shift @ARGV;
my @cmd = @ARGV;

my $pid = fork();
if (!defined $pid) { exit 126; }
if ($pid == 0) {
  exec { $cmd[0] } @cmd;
  exit 127; # exec failed
}

my $timedout = 0;
local $SIG{ALRM} = sub {
  $timedout = 1;
  kill "TERM", $pid;
  sleep 1;
  kill "KILL", $pid;
};
alarm($secs);
waitpid($pid, 0);
alarm(0);

exit 124 if $timedout;
exit($? >> 8);
PERL_TIMEOUT
  return $?
}

# ---- doc / CI flags -----------------------------------------------------------------------------

# has_architecture / has_invariants (§2.4): file exists AND >2KB AND does not contain the
# unfilled-template marker.
check_doc_flag() {
  local f="$1" size
  [ -f "$f" ] || { echo 0; return; }
  size=$(file_size "$f")
  if [ "$size" -gt 2048 ] && ! grep -q '<!-- TEMPLATE -->' "$f"; then
    echo 1
  else
    echo 0
  fi
}

is_frontend_stack() {
  printf '%s' "$1" | grep -qiE 'Next\.js|React|Vue|Svelte|Flutter'
}

check_ci() {
  local dir="$1"
  shopt -s nullglob
  local files=("$dir"/.github/workflows/*.yml "$dir"/.github/workflows/*.yaml)
  shopt -u nullglob
  if [ "${#files[@]}" -gt 0 ]; then echo 1; else echo 0; fi
}

# ---- tests ---------------------------------------------------------------------------------------

# File-marker based stack detection (independent of the DB `language` column, which may still be
# empty for projects not yet re-scanned by scan_repo — story 3).
detect_stack() {
  local dir="$1"
  if [ -f "$dir/pubspec.yaml" ]; then echo "dart"
  elif [ -f "$dir/requirements.txt" ] || [ -f "$dir/pyproject.toml" ]; then echo "python"
  else echo "js"
  fi
}

TEST_DIRS=(tests test __tests__ app/test backend/tests src/__tests__)

# tests_count (§2.4): grep-count test declarations across the standard test directories. None of
# TEST_DIRS nests another (tests/ test/ __tests__/ are siblings; app/test, backend/tests, src/__tests__
# live under different parents), so scanning each existing one independently never double-counts a file.
count_tests() {
  local dir="$1" stack="$2" pattern td existing=()
  case "$stack" in
    python) pattern='def test_' ;;
    dart)   pattern='testWidgets\(|test\(' ;;
    *)      pattern='it\(|test\(' ;;
  esac
  for td in "${TEST_DIRS[@]}"; do
    [ -d "$dir/$td" ] && existing+=("$dir/$td")
  done
  [ "${#existing[@]}" -eq 0 ] && { echo 0; return; }
  grep -rhoE "$pattern" "${existing[@]}" 2>/dev/null | wc -l | tr -d ' '
}

# tests_green (§2.4): run the ONE standard command for the detected stack, from the project root,
# under a timeout. No env injections, no guessing at custom commands — a project with a nonstandard
# test invocation gets tests_note set by hand elsewhere, this scanner never improvises one.
run_tests_green() {
  local dir="$1" stack="$2" rc
  case "$stack" in
    python)
      if [ -x "$dir/.venv/bin/pytest" ]; then
        ( cd "$dir" && run_with_timeout "$TIMEOUT_SECS" "$dir/.venv/bin/pytest" -q ) >/dev/null 2>&1
      elif command -v uv >/dev/null 2>&1; then
        ( cd "$dir" && run_with_timeout "$TIMEOUT_SECS" uv run pytest -q ) >/dev/null 2>&1
      else
        return 1
      fi
      ;;
    dart)
      command -v flutter >/dev/null 2>&1 || return 1
      ( cd "$dir" && run_with_timeout "$TIMEOUT_SECS" flutter test ) >/dev/null 2>&1
      ;;
    *)
      [ -f "$dir/package.json" ] || return 1
      ( cd "$dir" && run_with_timeout "$TIMEOUT_SECS" npm test ) >/dev/null 2>&1
      ;;
  esac
  rc=$?
  return $rc
}

# ---- health_score (§4.2) -------------------------------------------------------------------------
# Track A: score = 20*arch + 15*inv + 15*ci + 20*tgreen*min(1,tcount/20) + 15*audit_fresh + 15*clean
# Track B: score = 50*inv + 50*tgreen*min(1,tcount/10)                         (spec-forge-wave1 §4.2)
# Both reduce to pure-integer arithmetic since 20*min(1,x/20)==min(20,x) and 50*min(1,x/10)==min(50,5x).

is_audit_fresh() {
  local date_str="$1" audit_epoch now_epoch diff_days
  [ -z "$date_str" ] && { echo 0; return; }
  audit_epoch=$(date -j -f "%Y-%m-%d" "$date_str" "+%s" 2>/dev/null)
  [ -z "$audit_epoch" ] && audit_epoch=$(date -d "$date_str" "+%s" 2>/dev/null)
  [ -z "$audit_epoch" ] && { echo 0; return; }
  now_epoch=$(date "+%s")
  diff_days=$(( (now_epoch - audit_epoch) / 86400 ))
  if [ "$diff_days" -ge 0 ] && [ "$diff_days" -le 30 ]; then echo 1; else echo 0; fi
}

compute_health_score_a() {
  local arch="$1" inv="$2" ci="$3" tgreen="$4" tcount="$5" audit_fresh="$6" crit="$7" high="$8"
  local tests_term=0 clean=0
  if [ "$tgreen" -eq 1 ]; then
    tests_term="$tcount"
    [ "$tests_term" -gt 20 ] && tests_term=20
  fi
  [ "$crit" -eq 0 ] && [ "$high" -eq 0 ] && clean=1
  echo $(( 20*arch + 15*inv + 15*ci + tests_term + 15*audit_fresh + 15*clean ))
}

compute_health_score_b() {
  local inv="$1" tgreen="$2" tcount="$3" tests_term=0
  if [ "$tgreen" -eq 1 ]; then
    tests_term=$(( 5 * tcount ))
    [ "$tests_term" -gt 50 ] && tests_term=50
  fi
  echo $(( 50*inv + tests_term ))
}

# ---- spec parser (new taxonomy: .ai-codex/specs/*.md, not specs/done/) ---------------------------
#
# Delegated to perl for reliable UTF-8 handling of Cyrillic text + ⬜/✅ emoji (bash/grep byte
# matching on multi-byte UTF-8 works for literal search but not for the case-insensitive "нет" test).
# Prints one line: "OK|<title>|<stories_total>|<stories_done>|<has_block 0/1>" or "SKIP" for an
# unfilled template spec (contains the literal placeholder "[feature-slug]").
parse_spec_file() {
  local file="$1"
  perl - "$file" <<'PERL_SPEC'
use strict;
use warnings;
use utf8;
binmode(STDOUT, ":encoding(UTF-8)");

my $file = $ARGV[0];
open(my $fh, "<:encoding(UTF-8)", $file) or exit 2;
local $/;
my $text = <$fh>;
close $fh;

my @lines = split /\n/, $text;

# Unfilled-template guard: the shared template (~/.claude/templates/ai-codex/spec.md) has literal
# placeholders "[название фичи]" (title) / "[feature-slug]" (file-path comment) right at the top.
# Only check the first 10 lines — a *filled-in* real spec can legitimately mention "[feature-slug]"
# later in prose (e.g. explaining this very rule in its own edge cases), and that must not trip
# the skip (found scanning spec-forge-wave1.md itself against this parser).
my $head = join("\n", @lines[0 .. ($#lines < 9 ? $#lines : 9)]);
if ($head =~ /\[feature-slug\]/ || $head =~ /\[название\s*фичи\]/) {
  print "SKIP\n";
  exit 0;
}

# Title: first line matching "# Spec: <title>".
my $title = "";
for my $line (@lines) {
  if ($line =~ /^#\s*Spec:\s*(.+?)\s*$/) {
    $title = $1;
    last;
  }
}

# Стори block: from a line starting with "## Стори" up to (not including) the next "## " header.
# Only lines that look like table rows (start with "|") are eligible — this is what keeps DoD
# checkboxes (which also use ✅) from leaking into the count.
my $in_block = 0;
my $stories_total = 0;
my $stories_done = 0;
for my $line (@lines) {
  if ($in_block) {
    last if $line =~ /^## /;
    if ($line =~ /^\s*\|/) {
      my $has_done = ($line =~ /✅/) ? 1 : 0;
      my $has_todo = ($line =~ /⬜/) ? 1 : 0;
      if ($has_done || $has_todo) {
        $stories_total++;
        $stories_done++ if $has_done;
      }
    }
  } elsif ($line =~ /^## Стори/) {
    $in_block = 1;
  }
}

# has_block: like the Стори block above, scope to the Clarify-гейт section only ("в блоке
# Clarify-гейта строка с **BLOCK**") — a spec is free to explain this very mechanism in its own
# prose elsewhere (found spec-forge-wave1.md doing exactly that in its feature description, well
# before its actual gate section, which would otherwise false-positive as blocked).
my $in_gate = 0;
my @gate_lines;
for my $line (@lines) {
  if ($in_gate) {
    last if $line =~ /^## / && $line !~ /Clarify/;
    push @gate_lines, $line;
  } elsif ($line =~ /^## .*Clarify/) {
    $in_gate = 1;
    push @gate_lines, $line;
  }
}
# No Clarify-гейт section at all → nothing to gate on, treat as not blocked.
my $has_block = 0;
for my $line (@gate_lines) {
  next unless $line =~ /\*\*BLOCK\*\*/;
  my $idx = index($line, "**BLOCK**");
  my $rest = substr($line, $idx + length("**BLOCK**"));
  if ($rest =~ /^[^:\x{2013}\x{2014}-]*[:\x{2013}\x{2014}-]\s*(.*)$/) {
    my $after = $1;
    $after =~ s/^\s+//;
    $has_block = ($after =~ /^нет\.?(\s|$)/i) ? 0 : 1;
  } else {
    $has_block = 1;
  }
  last;
}

(my $safe_title = $title) =~ s/\|/-/g;
print "OK|$safe_title|$stories_total|$stories_done|$has_block\n";
PERL_SPEC
}

upsert_spec() {
  local slug="$1" file="$2" title="$3" total="$4" done_c="$5" blk="$6" mtime="$7"
  local scanned slug_e file_e title_e mtime_e scanned_e
  scanned=$(now_iso)
  slug_e=$(sql_escape "$slug"); file_e=$(sql_escape "$file"); title_e=$(sql_escape "$title")
  mtime_e=$(sql_escape "$mtime"); scanned_e=$(sql_escape "$scanned")
  sql "
    INSERT INTO specs (project_slug, file, title, stories_total, stories_done, has_block, updated_at, scanned_at)
    VALUES ('$slug_e', '$file_e', '$title_e', $total, $done_c, $blk, '$mtime_e', '$scanned_e')
    ON CONFLICT(project_slug, file) DO UPDATE SET
      title = excluded.title,
      stories_total = excluded.stories_total,
      stories_done = excluded.stories_done,
      has_block = excluded.has_block,
      updated_at = excluded.updated_at,
      scanned_at = excluded.scanned_at;
  "
}

delete_specs_not_in() {
  local slug="$1"; shift
  local files=("$@") slug_e f f_e list=""
  slug_e=$(sql_escape "$slug")
  if [ "${#files[@]}" -eq 0 ]; then
    sql "DELETE FROM specs WHERE project_slug = '$slug_e';"
    return
  fi
  for f in "${files[@]}"; do
    f_e=$(sql_escape "$f")
    if [ -z "$list" ]; then list="'$f_e'"; else list="$list, '$f_e'"; fi
  done
  sql "DELETE FROM specs WHERE project_slug = '$slug_e' AND file NOT IN ($list);"
}

scan_specs() {
  local slug="$1" proj_dir="$2" specs_dir="$proj_dir/.ai-codex/specs"
  local current_files=() kept=() f relpath parsed status title st_total st_done blk mtime

  if [ -d "$specs_dir" ]; then
    while IFS= read -r -d '' f; do
      current_files+=("$f")
    done < <(find "$specs_dir" -maxdepth 1 -type f -name '*.md' -print0 2>/dev/null)
  fi

  for f in "${current_files[@]}"; do
    relpath=".ai-codex/specs/$(basename "$f")"
    parsed=$(parse_spec_file "$f")
    IFS='|' read -r status title st_total st_done blk <<< "$parsed"
    [ "$status" != "OK" ] && continue   # SKIP (unfilled template) or unreadable file
    mtime=$(file_mtime_iso "$f")
    kept+=("$relpath")
    upsert_spec "$slug" "$relpath" "$title" "$st_total" "$st_done" "$blk" "$mtime"
  done

  delete_specs_not_in "$slug" "${kept[@]}"
}

# ---- per-project scan -----------------------------------------------------------------------------

scan_one_project() {
  local slug="$1" proj_dir="$2" frameworks_json="$3" track="$4"
  proj_dir="${proj_dir%/}"

  if [ ! -d "$proj_dir" ]; then
    echo "  ! $slug: local_path not found on disk ($proj_dir) — skipped" >&2
    return 1
  fi

  local has_arch has_inv has_design=0 has_ci_flag stack tcount tgreen=0

  has_arch=$(check_doc_flag "$proj_dir/.ai-codex/architecture.md")
  has_inv=$(check_doc_flag "$proj_dir/.ai-codex/invariants.md")
  if is_frontend_stack "$frameworks_json" && [ -f "$proj_dir/design.md" ]; then has_design=1; fi
  has_ci_flag=$(check_ci "$proj_dir")

  stack=$(detect_stack "$proj_dir")
  tcount=$(count_tests "$proj_dir" "$stack")

  if [ "$tcount" -gt 0 ] && [ "$FAST" -eq 0 ]; then
    if run_tests_green "$proj_dir" "$stack"; then tgreen=1; else tgreen=0; fi
  fi

  local row crit high audit_date slug_e
  slug_e=$(sql_escape "$slug")
  row=$(sql "SELECT open_crit, open_high, last_audit_date FROM projects WHERE slug = '$slug_e';")
  IFS='|' read -r crit high audit_date <<< "$row"
  crit=${crit:-0}; high=${high:-0}; audit_date=${audit_date:-}

  local audit_fresh score
  audit_fresh=$(is_audit_fresh "$audit_date")

  if [ "$track" = "A" ]; then
    score=$(compute_health_score_a "$has_arch" "$has_inv" "$has_ci_flag" "$tgreen" "$tcount" "$audit_fresh" "$crit" "$high")
  else
    score=$(compute_health_score_b "$has_inv" "$tgreen" "$tcount")
  fi

  sql "
    UPDATE projects SET
      has_architecture = $has_arch,
      has_invariants = $has_inv,
      has_design_md = $has_design,
      has_ci = $has_ci_flag,
      tests_count = $tcount,
      tests_green = $tgreen,
      health_score = $score
    WHERE slug = '$slug_e';
  "

  scan_specs "$slug" "$proj_dir"
  echo "  ok  $slug: arch=$has_arch inv=$has_inv design=$has_design ci=$has_ci_flag tests=$tcount green=$tgreen score=$score"
  return 0
}

# ---- drivers ----------------------------------------------------------------------------------

run_all() {
  local rows slug local_path frameworks track ok_count=0 err_count=0
  rows=$(sql "SELECT slug, local_path, frameworks, track FROM projects WHERE local_path <> '' ORDER BY slug;")
  echo "keystack-scan: scanning all projects (fast=$FAST)"
  while IFS='|' read -r slug local_path frameworks track; do
    [ -z "$slug" ] && continue
    if scan_one_project "$slug" "$local_path" "$frameworks" "$track"; then
      ok_count=$((ok_count + 1))
    else
      err_count=$((err_count + 1))
    fi
  done <<< "$rows"
  echo "── summary: $ok_count ok, $err_count error(s) ──"
}

run_single() {
  local path="$1" row slug local_path frameworks track
  path="${path%/}"
  row=$(sql "SELECT slug, local_path, frameworks, track FROM projects WHERE local_path = '$(sql_escape "$path")' LIMIT 1;")
  if [ -z "$row" ]; then
    echo "keystack-scan.sh: no project found in DB with local_path = $path" >&2
    exit 1
  fi
  IFS='|' read -r slug local_path frameworks track <<< "$row"
  scan_one_project "$slug" "$local_path" "$frameworks" "$track"
}

if [ "$ALL" -eq 1 ]; then
  run_all
else
  run_single "$TARGET"
fi
