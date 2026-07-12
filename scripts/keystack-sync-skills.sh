#!/usr/bin/env bash
# keystack-sync-skills.sh — deterministic sync of the keystack `skills` table from the
# global skills folder (~/.claude/skills/*/SKILL.md). NO LLM.
#
# Scope (FORGE wave1 story 3, spec-forge-wave1.md in the keystack repo): ONLY the global
# skills namespace under ~/.claude/skills. Plugin-provided skills and project-scoped skills
# (e.g. a repo's own .claude/skills/) are a DIFFERENT namespace and are never touched here —
# existing DB rows whose `location` is anything other than this folder (e.g. "Claude Code
# builtin", or a project path) are left alone, on purpose.
#
# Idempotent / rerunnable:
#   - upsert by slug (= folder name) for every ~/.claude/skills/<slug>/SKILL.md found
#   - delete any DB row whose location == "$SKILLS_DIR" (this script's own namespace marker)
#     but whose slug no longer has a matching folder (phantom)
#
# Usage: keystack-sync-skills.sh
# Env:   CLAUDE_SKILLS_DIR (default ~/.claude/skills), KEYSTACK_HOME (default ~/.keystack)

set -o pipefail   # deliberately NOT -e/-u — see keystack-scan.sh for the bash-3.2 rationale

SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
# Location value stored in the DB — kept as the literal, unexpanded '~/.claude/skills' string to
# match the convention already used by the one pre-existing row (motion-landing) before this
# script existed. Phantom-cleanup matches on this same literal, not the resolved absolute path.
SKILLS_LOC="${CLAUDE_SKILLS_LOC:-~/.claude/skills}"
KEYSTACK_HOME="${KEYSTACK_HOME:-$HOME/.keystack}"
DB="$KEYSTACK_HOME/keystack.db"

if [ ! -f "$DB" ]; then
  echo "keystack-sync-skills.sh: no DB at $DB — run the keystack MCP server once first (it creates/migrates it)" >&2
  exit 1
fi
if [ ! -d "$SKILLS_DIR" ]; then
  echo "keystack-sync-skills.sh: no skills dir at $SKILLS_DIR" >&2
  exit 1
fi

sql() { sqlite3 -separator '|' "$DB" "$@"; }
sql_escape() { printf '%s' "$1" | sed "s/'/''/g"; }
now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# Parses a SKILL.md frontmatter block (--- ... ---) for name/description. Handles both a
# single-line scalar (`description: text`) and a YAML block scalar (`description: |` followed
# by indented lines, as used by motion-landing/watch). Prints NAME on line 1, DESCRIPTION
# (collapsed to one line) on line 2 — plain newline-delimited, read back with two `read -r`
# calls below. (A single-line NUL/0x01-delimited encoding was tried first but bash 3.2's `read`
# does not reliably split on a control-character IFS — two lines + two `read`s sidesteps that.)
parse_skill_frontmatter() {
  local file="$1"
  perl - "$file" <<'PERL_SKILL'
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
exit 3 unless @lines && $lines[0] =~ /^---\s*$/;

my $name = "";
my $desc = "";
my $i = 1;
while ($i <= $#lines && $lines[$i] !~ /^---\s*$/) {
  my $line = $lines[$i];
  if ($line =~ /^name:\s*(.+?)\s*$/) {
    $name = $1;
    $name =~ s/^["']|["']$//g;
    $i++;
  } elsif ($line =~ /^description:\s*\|\s*$/) {
    # Block scalar: collect subsequent indented (or blank) lines until dedent/end of frontmatter.
    my @block;
    $i++;
    while ($i <= $#lines && $lines[$i] !~ /^---\s*$/ && ($lines[$i] =~ /^\s/ || $lines[$i] eq "")) {
      (my $l = $lines[$i]) =~ s/^  //;
      push @block, $l;
      $i++;
    }
    $desc = join(" ", grep { $_ ne "" } @block);
  } elsif ($line =~ /^description:\s*(.+?)\s*$/) {
    $desc = $1;
    $desc =~ s/^["']|["']$//g;
    $i++;
  } else {
    $i++;
  }
}

print "$name\n$desc\n";
PERL_SKILL
}

upsert_skill() {
  local slug="$1" name="$2" desc="$3" loc="$4"
  local slug_e name_e desc_e loc_e now
  now=$(now_iso)
  slug_e=$(sql_escape "$slug"); name_e=$(sql_escape "$name")
  desc_e=$(sql_escape "$desc"); loc_e=$(sql_escape "$loc")
  sql "
    INSERT INTO skills (slug, name, description, what_it_does, location, tags, created_at, updated_at)
    VALUES ('$slug_e', '$name_e', '$desc_e', '', '$loc_e', '[]', '$now', '$now')
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      location = excluded.location,
      updated_at = excluded.updated_at;
  "
}

kept=()
for dir in "$SKILLS_DIR"/*/; do
  [ -d "$dir" ] || continue
  slug="$(basename "$dir")"
  skill_md="$dir/SKILL.md"
  [ -f "$skill_md" ] || continue
  parsed=$(parse_skill_frontmatter "$skill_md")
  { IFS= read -r name; IFS= read -r desc; } <<< "$parsed"
  [ -z "$name" ] && name="$slug"
  upsert_skill "$slug" "$name" "$desc" "$SKILLS_LOC"
  kept+=("$slug")
  echo "  ok  $slug"
done

# Phantom cleanup — scoped to THIS namespace only (location == $SKILLS_LOC); rows tagged with
# any other location (plugin skills, project skills, "Claude Code builtin") are never touched.
loc_e=$(sql_escape "$SKILLS_LOC")
existing_rows=$(sql "SELECT slug FROM skills WHERE location = '$loc_e';")
removed=0
while IFS= read -r slug; do
  [ -z "$slug" ] && continue
  found=0
  for k in "${kept[@]}"; do
    [ "$k" = "$slug" ] && { found=1; break; }
  done
  if [ "$found" -eq 0 ]; then
    slug_e=$(sql_escape "$slug")
    sql "DELETE FROM skills WHERE slug = '$slug_e';"
    echo "  rm  $slug (phantom — no SKILL.md at $SKILLS_DIR/$slug)"
    removed=$((removed + 1))
  fi
done <<< "$existing_rows"

echo "── summary: ${#kept[@]} skill(s) synced, $removed phantom(s) removed ──"
