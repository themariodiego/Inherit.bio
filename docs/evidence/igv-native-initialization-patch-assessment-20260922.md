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
