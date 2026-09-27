# Export work integration — 25 September 2026

The asynchronous export work existed only on the owner's workstation: four
commits on `codex/async-export-delivery` and two untracked ZIP64 files. The
owner transferred it as a bundle and chose, the same day, to back it up
unchanged and integrate it onto `main` in its own pull request
(`docs/protocol/decisions.md`). This is that integration. **G5.6 stays NO**:
member selection, routes, worker dispatch, ready publication, revocable
downloads and physical cleanup are still missing.

## Transfer

| Check | Result |
| --- | --- |
| Package manifest | All seven files match their SHA-256 entries |
| Untracked files | `archive-zip64.ts` `7e052c78…c5`, `archive-zip64.test.ts` `a846895d…79`: equal to the manifest and to the separately recorded handoff |
| `git bundle verify` | okay; its one prerequisite, `fe09e3e`, is an ancestor of `main` |
| Imported head | `da576e5c9aeeaa76bf4c809f1ede0a618abd1796`, the four commits in recorded order |
| Backup | Pushed unchanged as `codex/async-export-delivery` |
| Transferred tests on their own base | 361 of 361 across seven files, ZIP64 63 of 63 |

## Integration

`main` (`57d6b4e`) is merged in; nothing is rebased, so the four transferred
commit identities remain. The only conflict was the append-only
`docs/test-diff-register.md`, resolved by keeping both sides. Against `main`
the diff is exactly the branch's own 19 files.

The brief paragraph this work adds under G5.6 is labelled as the owner's
25 September decision, and `docs/route-register.json`'s `briefSha256` pin moves
with it. A planted stale pin fails both the route tests and `gate:routes`.

## First execution of the persistence migration

Run on a local stack in the cloud container the owner approved for this. The
migration applied cleanly after every earlier one. The pgTAP suite then failed
before its first assertion:

- `private.export_archive_authority_v1` declares a `record` variable `s` and
  aliases `public.subjects` as `s` in three queries. PL/pgSQL resolved
  `s.subject_class` to the unassigned variable: `record "s" is not assigned
  yet`, so every export request would have failed.
- `public.export_archive_worker_v1` declares a `%rowtype` variable `s` and
  aliases `export_archive_segments` as `s` in the `page` query: `42702 column
  reference "s.ordinal" is ambiguous`.

A census of every function in the migration found exactly those four aliases.
Each is renamed inside its own statement only (`subj`, `seg`); every intended
variable reference is untouched. After the fix:

| Suite | Result |
| --- | --- |
| `supabase/tests/export_archive_persistence.sql` | 77 of 77 |
| Full pgTAP suite | 90 files, 3,751 assertions, all pass: `main`'s 3,674 plus these 77 |
| Independent-session lock checks | 30 of 30 |
| Coverage check | Reverting only the worker rename fails assertion 58, "manifest must equal acknowledged identities, not caller descriptor claims" |

## ZIP64 producer

Reviewed against PKWARE APPNOTE 6.3.10: local header, ZIP64 data descriptor,
central record, ZIP64 end record, locator and end record have correct field
offsets and signatures, CRC-32 is standard, and member names cannot traverse
or collide. A real archive written by the committed producer through its file
spool (604 members: an empty file, a 9.5 MB file streamed in 1 MB chunks and
600 small reports; 9,659,946 bytes) was read by:

| Reader | Result |
| --- | --- |
| Info-ZIP `unzip -t` | No errors |
| Python `zipfile` | 604 of 604 byte-identical, stored, ZIP64 extra on every entry |
| libarchive `bsdtar`, seeking | 604 of 604 byte-identical |
| libarchive `bsdtar`, from a pipe | 604 of 604 byte-identical |
| 7-Zip 23.01 `t` | Everything is Ok, 604 files |

Not tried: macOS Archive Utility and Windows Explorer. The archive is below
4 GiB, so large offsets remain proven only by the virtual-metadata tests.

## Branch checks

`pnpm typecheck` (with route-type generation) and `pnpm lint` exit 0.
`gate:routes`, `claims`, `env`, `templates`, `jurisdictions`, `first-glance`,
`legal` and `readability` pass. The unit suite's result is in the pull
request. Seventeen browser-dependent unit suites need a Chromium build this
container does not have; they fail identically on untouched `main` and run
in CI.

## What is next

`docs/export-member-selection-design.md`, the owner's read-only design
carried in the transfer package and committed here unchanged, describes the
next slice: the bounded service-only content reader and exhaustive,
keyset-paginated member selection with a versioned member-plan receipt.
