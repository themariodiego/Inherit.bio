#!/usr/bin/env bash
# LOCAL ONLY: the revised predecessor guard of 20261025400000 on the mirror of the
# follow-up's post-state (production's drift included). Each case is one transaction
# that is rolled back: a setup, then the migration file as the CLI runs it, then a
# probe of whether its door exists. The fingerprint and ledger must be unchanged after
# each. The file is read from the pinned migrations tree (generate.py REV_TREE).
#   negatives-m04-guard.sh <repository body .sql>
# <repository body .sql> is pg_get_functiondef of private.current_adult_subject_invitation_v1
# captured on a fresh build (the repository text, with its 2 comment lines).
# The caller exports PGPASSWORD for the local stack.
set -u
. "$(dirname "$0")/env.sh"
REPOBODY=$1
L=${NEG_LOG:-$W/logs/negatives-m04}; mkdir -p "$L"
OUT=$L/results.tsv; : > "$OUT"
TREE=$(sed -n "s/^REV_TREE = '\([0-9a-f]*\)'.*/\1/p" "$G/generate.py")
git -C "$REPO" show "$TREE:20261025400000_path_a_account_accept_typed_name.sql" > "$L/m04.sql"
[ "$(ledger)" = "280 20261023140000" ]
st() { echo "$(fpto /dev/stdout | sha256sum | cut -c1-16) $(ledger)"; }
CNT="select count(distinct x.signature) from pg_proc p join (values
 ('private.current_adult_subject_invitation_v1(uuid,uuid)','7fa7e1fe73fc4db2ecf9af8a7b26d265'),
 ('private.current_adult_subject_invitation_v1(uuid,uuid)','78d147935e25d657d8df631583c6faea'),
 ('private.consume_embryo_operation_nonce_v1(text,uuid,uuid,text,text,uuid)','db5ce99583d6e1724eae8490eec6a9ef'),
 ('private.lock_invitation_transitions_v1()','3a28aeaf4bf736cbba89e3b209649557'),
 ('private.declare_contact_alias_groups_v1(jsonb)','60f413613a40bc0186e1edfc60518863'),
 ('private.resolve_hmac_set_v1(text,text,jsonb)','40d84663185bb3fe5fa5b67be4b364e3'),
 ('private.presented_contact_digest_v1(jsonb,text,bigint)','d0fef1099b2a5f5da60b43fc93a82437')
 ) as x(signature,body) on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body"
case_() {  # case_ <name> <setup sql file or empty>
  local name=$1 setup=$2 before after
  before=$(st)
  { echo '\set ON_ERROR_STOP 0'; echo 'begin;'; [ -n "$setup" ] && echo "\\i $setup"
    echo "select 'callee md5 '||coalesce(md5(pg_get_functiondef(to_regprocedure('private.current_adult_subject_invitation_v1(uuid,uuid)'))),'absent');"
    echo "select 'distinct callees matched '||($CNT);"
    echo 'savepoint m;'; echo "\\i $L/m04.sql"
    echo "select 'door after the file: '||case when to_regprocedure('public.accept_adult_subject_invitation_v1(text,text,uuid,uuid,jsonb,bytea)') is null then 'absent' else 'present' end;"
    echo 'rollback;'; } > "$L/$name.sql"
  psql "$DB" -X -q -At -f "$L/$name.sql" > "$L/$name.log" 2>&1
  after=$(st)
  echo -e "$name\t$(grep -E '^(callee md5|distinct callees)' "$L/$name.log" | tr '\n' ' ')\t$(grep -o 'ERROR:.*' "$L/$name.log" | grep -v 'current transaction is aborted' | head -1)\t$(grep -o 'door after the file: .*' "$L/$name.log")\tstate $([ "$before" = "$after" ] && echo unchanged || echo CHANGED)" | tee -a "$OUT"
}
# Controls: production's stripped body (the mirror as built), then the repository body.
case_ stripped-body ""
{ cat "$REPOBODY"; echo ';'; } > "$L/setup-repository-body.sql"
case_ repository-body "$L/setup-repository-body.sql"
# A third body: the stripped body with one token changed (> to >=).
cat > "$L/setup-third-body.sql" <<'SQL'
do $neg$ declare d text; begin
 select pg_catalog.pg_get_functiondef('private.current_adult_subject_invitation_v1(uuid,uuid)'::regprocedure) into d;
 if position('and d.fixed_expires_at > v_now' in d) = 0 then raise exception 'token not found'; end if;
 execute replace(d, 'and d.fixed_expires_at > v_now', 'and d.fixed_expires_at >= v_now'); end $neg$;
SQL
case_ third-body "$L/setup-third-body.sql"
# The callee missing: renamed away, so its signature resolves to nothing.
echo "alter function private.current_adult_subject_invitation_v1(uuid,uuid) rename to current_adult_subject_invitation_v1_moved;" > "$L/setup-callee-missing.sql"
case_ callee-missing "$L/setup-callee-missing.sql"
# Another callee's body changed: resolve_hmac_set_v1 without its one full-line comment
# (the two-body allowance is for current_adult_subject_invitation_v1 alone).
cat > "$L/setup-other-callee.sql" <<'SQL'
do $neg$ declare d text; begin
 select pg_catalog.pg_get_functiondef('private.resolve_hmac_set_v1(text,text,jsonb)'::regprocedure) into d;
 if d !~ E'\n[ \t]*--' then raise exception 'no full-line comment to strip'; end if;
 execute pg_catalog.regexp_replace(d, E'\n[ \t]*--[^\n]*', '', 'g'); end $neg$;
SQL
case_ other-callee-changed "$L/setup-other-callee.sql"
