#!/usr/bin/env bash
# LOCAL ONLY: generate.py's refusals, in a scratch clone (git clone --shared, so the
# synthetic commits below are written to the clone only, never to this repository).
# Release 3's generator-negatives.sh, for release 4. Every synthetic commit (no ref) has
# fe8c69d1 as its parent and fe8c69d1's tree with its supabase/migrations replaced:
#   control  a commit carrying exactly REV_TREE with one more document change: accepted;
#            REV_TREE named directly: accepted, LOCAL ONLY;
#   A        REV_TREE pinned (in the clone's copy only) to a tree whose earlier migration
#            20261025400000_path_a_account_accept_typed_name.sql (release 3's) gains a
#            trailing comment line: refused;
#   B        --head a commit whose 20261122120000_subject_transfer_open.sql gains a
#            trailing comment line: refused;
#   C        --head 6252566a, the last commit carrying release 3's tree be49d283 (the head
#            release 3 merges): refused;
#   D        BATCHES not covering the 21 files consecutively (in the clone's copy only): refused.
set -eu
. "$(dirname "$0")/env.sh"
C=$W/gen-clone
TREE=$(sed -n "s/^REV_TREE = '\([0-9a-f]*\)'.*/\1/p" "$G/generate.py")
PARENT=fe8c69d1a9c5b47dbfd45daf61728f7e5cc77ee1
rm -rf "$C" && git clone -q --shared --no-checkout "$REPO" "$C"
git -C "$C" checkout -q --detach "$PARENT"
rm -rf "$C/docs/evidence/followup-3-production-apply-20261122"
cp -r "$KIT" "$C/docs/evidence/followup-3-production-apply-20261122"
mk() {  # mk [<file to append a comment line to>] -> prints "<commit> <migrations tree>"
  local tree mt blob
  git -C "$C" read-tree "$PARENT"
  git -C "$C" rm -r -q --cached supabase/migrations
  git -C "$C" read-tree --prefix=supabase/migrations/ "$TREE"
  if [ -n "${1:-}" ]; then
    blob=$( (git -C "$C" show "$TREE:$1"; echo '-- synthetic change for the generator refusal test') | git -C "$C" hash-object -w --stdin)
    git -C "$C" update-index --cacheinfo "100644,$blob,supabase/migrations/$1"
  else
    blob=$( (git -C "$C" show "$PARENT:README.md"; echo 'synthetic document change') | git -C "$C" hash-object -w --stdin)
    git -C "$C" update-index --cacheinfo "100644,$blob,README.md"
  fi
  tree=$(git -C "$C" write-tree); mt=$(git -C "$C" rev-parse "$tree:supabase/migrations")
  git -C "$C" read-tree HEAD
  echo "$(echo "synthetic" | git -C "$C" commit-tree "$tree" -p "$PARENT") $mt"
}
read -r OK OKT <<<"$(mk)"
read -r A AT <<<"$(mk 20261025400000_path_a_account_accept_typed_name.sql)"
read -r B BT <<<"$(mk 20261122120000_subject_transfer_open.sql)"
cd "$C/docs/evidence/followup-3-production-apply-20261122/guarded"
[ "$OKT" = "$TREE" ]
echo "control (--head a commit carrying REV_TREE ${TREE:0:8} with a document change): $(python3 -I generate.py --head "$OK" list 2>&1 | head -1)"
echo "control (--head REV_TREE itself): $(python3 -I generate.py --head "$TREE" list 2>&1 | head -1)"
sed "s/^REV_TREE = '[0-9a-f]*'/REV_TREE = '$AT'/" generate.py > generate-a.py
echo "A (REV_TREE a tree that changes one of release 3's migrations): $(python3 -I generate-a.py --head "$A" list 2>&1 | tail -1)"
echo "B (--head a commit whose tree changes 20261122120000): $(python3 -I generate.py --head "$B" list 2>&1 | tail -1)"
echo "C (--head 6252566a, release 3's head): $(python3 -I generate.py --head 6252566acf7d94064b6e899ac76a72796036b8d8 list 2>&1 | tail -1)"
sed "s/^BATCHES = .*/BATCHES = [(1, 2), (3, 7), (9, 21)]/" generate.py > generate-d.py
echo "D (BATCHES that skip #8): $(python3 -I generate-d.py list 2>&1 | tail -1)"
