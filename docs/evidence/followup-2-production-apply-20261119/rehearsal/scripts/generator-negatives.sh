#!/usr/bin/env bash
# LOCAL ONLY: generate.py's refusals, in a scratch clone (git clone --shared, so the
# synthetic commits below are written to the clone only, never to this repository).
# Every synthetic commit (no ref) has d8dcb61a as its parent and d8dcb61a's tree with its
# supabase/migrations replaced:
#   control  a commit carrying exactly REV_TREE: accepted (what the commit of the revised
#            file will do), and REV_TREE named directly: accepted, LOCAL ONLY;
#   A        REV pinned (in the clone's copy only) to a tree whose earlier migration
#            20261023140000_review_download_clock.sql gains a trailing comment line: refused;
#   B        --head a commit whose 20261025400000 gains a trailing comment line: refused;
#   C        --head d8dcb61a, the first rehearsal's tree with the unrevised 20261025400000: refused.
set -eu
. "$(dirname "$0")/env.sh"
C=$W/gen-clone
TREE=$(sed -n "s/^REV_TREE = '\([0-9a-f]*\)'.*/\1/p" "$G/generate.py")
rm -rf "$C" && git clone -q --shared --no-checkout "$REPO" "$C"
git -C "$C" checkout -q --detach d8dcb61a0beb4f4616046b38a03ab5ed4d9c666c
rm -rf "$C/docs/evidence/followup-2-production-apply-20261119"
cp -r "$KIT" "$C/docs/evidence/followup-2-production-apply-20261119"
mk() {  # mk [<file to append a comment line to>] -> prints "<commit> <migrations tree>"
  local tree mt blob
  git -C "$C" read-tree d8dcb61a
  git -C "$C" rm -r -q --cached supabase/migrations
  git -C "$C" read-tree --prefix=supabase/migrations/ "$TREE"
  if [ -n "${1:-}" ]; then
    blob=$( (git -C "$C" show "$TREE:$1"; echo '-- synthetic change for the generator refusal test') | git -C "$C" hash-object -w --stdin)
    git -C "$C" update-index --cacheinfo "100644,$blob,supabase/migrations/$1"
  fi
  tree=$(git -C "$C" write-tree); mt=$(git -C "$C" rev-parse "$tree:supabase/migrations")
  git -C "$C" read-tree HEAD
  echo "$(echo "synthetic" | git -C "$C" commit-tree "$tree" -p d8dcb61a) $mt"
}
read -r OK OKT <<<"$(mk)"
read -r A AT <<<"$(mk 20261023140000_review_download_clock.sql)"
read -r B BT <<<"$(mk 20261025400000_path_a_account_accept_typed_name.sql)"
cd "$C/docs/evidence/followup-2-production-apply-20261119/guarded"
[ "$OKT" = "$TREE" ]
echo "control (--head a commit carrying REV_TREE ${TREE:0:8}): $(python3 -I generate.py --head "$OK" list 2>&1 | head -1)"
echo "control (--head REV_TREE itself): $(python3 -I generate.py --head "$TREE" list 2>&1 | head -1)"
sed "s/^REV_TREE = '[0-9a-f]*'/REV_TREE = '$AT'/" generate.py > generate-a.py
echo "A (REV_TREE a tree that changes one earlier migration): $(python3 -I generate-a.py --head "$A" list 2>&1 | tail -1)"
echo "B (--head a commit whose tree changes 20261025400000): $(python3 -I generate.py --head "$B" list 2>&1 | tail -1)"
echo "C (--head d8dcb61a, the unrevised 20261025400000): $(python3 -I generate.py --head d8dcb61a list 2>&1 | tail -1)"
