# Native viewer initialization patch assessment · 22 September 2026

The repository registers the exact-version `igv@3.8.5` pnpm patch described
below, stacked on the viewer ownership work in PR #197. Other dependency
versions are preserved. The shared installed dependency was not edited;
validation used task-owned installs and an isolated dependency overlay.

`patches/igv@3.8.5.patch` changes both package entry builds: the ESM file named
by `main`/`module` and the UMD file named by `browser`.
After a browser is constructed and registered, session loading, navigation
resize and optional WebSocket setup are wrapped in a try/catch. On failure the
existing native `removeBrowser(browser)` releases that exact instance before
the original error is rethrown. Native `removeKeyboardHandler` now removes its
own callback. There is no global listener interception or `removeAllBrowsers`.
The minified subpath builds are outside this patch; they are not package entry
fields and the application imports `igv/dist/igv.esm.js` explicitly.

The [comparison receipt](igv-native-initialization-patch-assessment-20260922.json)
records the source and patch hashes. `git apply --check` and `git apply` succeeded
against isolated copies of both installed 3.8.5 entry files. A fresh minimal
pnpm 10.33.0 install registered the exact-version patch; a second clean install
with its frozen lockfile reproduced identical patched entry hashes. Both used
separate dependency stores and no lifecycle scripts. Fresh Chromium contexts
ran each original entry and each clean-installed patched entry with the same
synthetic data. A valid viewer
was opened first, then a second viewer's native reference File rejected its
`arrayBuffer` read. Both builds preserved the rejection's original message.

| Observation | Original | Patched |
| --- | --- | --- |
| Keyboard/resize listeners with first viewer live | 1 / 1 | 1 / 1 |
| Keyboard/resize listeners after second creation fails | 2 / 2 | 1 / 1 |
| Failed viewer roots left in its shadow tree | 1 | 0 |
| First viewer remains connected, renders and searches | Yes | Yes |
| First viewer retains its synthetic feature | Yes | Yes |
| Keyboard/resize listeners after removing first viewer | 2 / 1 | 0 / 0 |
| Uncaught browser errors or external requests | 0 / 0 | 0 / 0 |

Both ESM and UMD yielded every result in the table. The failure and
normal-removal cases therefore have direct native evidence,
including preservation of an unrelated live viewer. The existing instance
keyup cleanup in PR #197 remains harmless with this patch because removing the
same event listener twice is safe.

Four maintained native regressions exercise both installed package entries.
They reproduce a reference File read failure with another viewer still active,
then check repeated normal creation/removal. The assertions inspect actual
Chromium document/window listeners, the native shadow tree, the surviving
viewer's search and feature cache, uncaught errors and network origins.
The existing instance-level helper and its eight lifecycle cases are retained.
The combined 73 focused checks in ten suites pass against the patched package.
After removing only the patch metadata and IGV patch-hash suffixes, the
repository lockfile is byte-identical to the base lockfile. A fresh task-owned
copy of the full project manifest, workspace settings, lockfile and patch passes
pnpm's offline frozen lockfile-only validation without changing the lockfile.
That validates the full project's locked graph; the clean package installations
above establish actual patch application. A complete project installation and
full-app CI remain required.

The comparison and regression claims cover failure after construction and
registration, during a native reference read, plus normal removal. A constructor
that throws before returning an instance, a secondary exception inside native
disposal, and other asynchronous track-load failure permutations are outside
these measured claims. G1.13b remains NO; dynamic region queries and the broader
release criteria are unchanged.


## Same-document teardown correction

Full CI run 35755611547 at `e0a1dc747d026964f0d526eb9e2e0147d9b2e02f`
passed 502 browser cases but the viewer-to-upload case exhausted its 120-second
budget while waiting for the My Genome heading. Its bounded diagnostic receipt
showed a successful My Genome response (HTTP 200), the new URL and zero page or
console errors. It never reached the upload stage. The preceding run
35744757008 had failed after two clicks without the hub waypoint.

A standalone Chromium reproduction identifies a detached-tree mutation loop:
the scrolling adapter removes a range when its native thumb is disconnected,
then recreates that range from the still-owned native track list. Each pass
queues another observer callback. A pending mutation can therefore starve the
later passive-effect cleanup task after React detaches the host. Four diagnostic
reproductions hit a 500-callback watchdog; with the attached-host guard, each
settled after 32 callbacks and allowed the scheduled cleanup to run.

The scrolling adapter now ignores updates after its own host is detached or
its disposer has aborted. Instance ownership and disposal remain unchanged.
A maintained regression loads the installed native viewer with synthetic data,
closes its unknown-position alert, queues a viewport mutation, detaches the
host, and schedules disposal and the next page in a later task. A 100-callback
watchdog keeps the regression bounded, and the test requires that watchdog to
remain unused, actual native roots to be removed, the next page to become
visible and no browser error to occur. The test failed at the watchdog assertion
with the guard removed and passes with it restored. Existing full-app navigation,
network, upload and timeout assertions are unchanged. Full application CI for
this correction remains required; the standalone reproduction does not replace
that journey or change any release verdict.

The correction passes 65 focused checks in ten suites, including the new native
detachment regression, scrolling, interaction, popover, ownership, entry-build
cleanup, navigation, reference, diagnostic and keyboard traversal cases.
Changed-file lint, full typecheck and readability also pass. Full application
CI is the remaining validation of the real route-and-upload sequence.
