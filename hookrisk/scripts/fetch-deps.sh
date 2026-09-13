#!/usr/bin/env bash
#
# Materialise harness/lib/ from harness/deps.lock at the exact pinned commits.
#
# Idempotent: an existing checkout already at the right commit is left alone, so
# re-running costs one `git rev-parse`. Safe to call from CI on every job.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK="$ROOT/harness/deps.lock"
LIB="$ROOT/harness/lib"

[[ -f "$LOCK" ]] || { echo "missing $LOCK" >&2; exit 1; }
mkdir -p "$LIB"

status=0
while read -r name url commit _rest; do
  # Skip blank lines and comments.
  [[ -z "${name:-}" || "$name" == \#* ]] && continue

  dest="$LIB/$name"

  if [[ -d "$dest/.git" ]] && [[ "$(git -C "$dest" rev-parse HEAD 2>/dev/null)" == "$commit" ]]; then
    printf '  %-24s %s (cached)\n' "$name" "${commit:0:12}"
    continue
  fi

  printf '  %-24s %s ' "$name" "${commit:0:12}"
  rm -rf "$dest"
  # Fetching a single commit into an empty repo avoids cloning full history for
  # dependencies whose history we will never read.
  git init -q "$dest"
  git -C "$dest" remote add origin "$url"
  if git -C "$dest" fetch -q --depth 1 origin "$commit" 2>/dev/null; then
    git -C "$dest" checkout -q FETCH_HEAD
  else
    # Some hosts refuse to serve arbitrary SHAs to a shallow fetch; fall back to
    # a full clone and check the commit out from there.
    git -C "$dest" fetch -q --tags origin
    git -C "$dest" checkout -q "$commit"
  fi

  actual="$(git -C "$dest" rev-parse HEAD)"
  if [[ "$actual" != "$commit" ]]; then
    echo "MISMATCH (got $actual)"
    status=1
  else
    echo "ok"
  fi
done < "$LOCK"

# The corpus is its own Foundry project but shares the harness's dependency
# tree. It reaches them through a symlink rather than a `libs = ["../harness/lib"]`
# entry because crytic-compile cannot normalise parent-relative library paths and
# fails with `AssertionError: Contract <name> not found` — see HR-E201 in
# docs/TROUBLESHOOTING.md. Creating the link here rather than committing it keeps
# the checkout usable on filesystems without symlink support.
link_lib() {
  local project="$1"
  local target="$2"
  if [[ -L "$project/lib" ]]; then
    rm -f "$project/lib"
  elif [[ -e "$project/lib" ]]; then
    echo "  ! $project/lib exists and is not a symlink — leaving it alone" >&2
    return 0
  fi
  if ln -s "$target" "$project/lib" 2>/dev/null; then
    printf '  %-24s -> %s\n' "$(basename "$project")/lib" "$target"
  else
    # Windows without developer mode, or a filesystem that refuses symlinks.
    echo "  ! could not symlink $project/lib; copying instead (slower)" >&2
    cp -R "$ROOT/harness/lib" "$project/lib"
  fi
}

link_lib "$ROOT/corpus" "../harness/lib"

exit "$status"
