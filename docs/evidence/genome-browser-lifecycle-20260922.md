# Genome viewer disposal · 22 September 2026

Leaving the genome viewer or changing the selected region cleared only the
container's light DOM. The installed viewer appends its own root inside an open
shadow tree and registers each browser globally. Clearing `innerHTML` therefore
left the old root, the library's browser registry entry, and document/window
callbacks alive. Initialization could also finish after unmount or the existing
30-second timeout, when the component no longer owned the returned instance.

A standalone Chromium probe with the installed library and synthetic inline
features reproduced all three cases. After the old cleanup, a library-wide
visibility notification still reached the retired instance; its resize and
keyboard handlers remained registered. Native `removeBrowser` released the
root, registry and resize callback, but the installed version's
`removeKeyboardHandler` incorrectly added its instance callback again. An
explicit removal of that same instance callback released it. This finding is
about library lifecycle behavior, not an observed disclosure to another user.

Each initialization now owns a separate child host. Cancellation or timeout
removes that host immediately, so a late initialization cannot reappear beside
its replacement. The creation promise remains observed: any returned instance
is disposed exactly once, including one returned after cancellation. Normal
cleanup calls the library's own `removeBrowser` and then removes only that
instance's `keyUpHandler`, without patching global listener or network methods.
The existing control, scrolling and popover adapters bind the owned host and
are released before the native viewer. Mount errors release them too.

Eight regressions run in standalone Chromium. Six use the installed viewer to
check normal disposal, late completion alongside a newer instance, timeout,
repeated region replacement, cancellation before creation and a disposal
exception after late creation. Separate fixtures cover a rejected creation and
a missing handle. The tests verify
registry notifications, document keyboard events, window resize events, shadow
roots and preservation of unrelated listeners. All data and intercepted
transport responses are explicitly synthetic.

The 30-second initialization timeout, first-party reference, authenticated
region reads, controls, upload behavior and safety bounds remain unchanged.
All 69 focused lifecycle, reference, navigation, control, scrolling, popover, viewport,
keyboard and copy tests pass; changed-file lint, typecheck and readability pass.
Full-app CI is still required. This does not implement fresh region queries
while panning or searching, complete the region pagination/nonce protocol, or
close G1.13b. A [separate native rejection probe](genome-browser-lifecycle-native-rejection-20260922.json)
confirms an unresolved library boundary.
A synthetic reference File whose `arrayBuffer` rejects causes creation to fail
after IGV has registered its instance. The owned DOM host is removed, but
Chromium's listener inspector still finds document `keyup` and window `resize`
callbacks at installed source lines 84171 and 84091, where neither existed
before creation. The module exports no browser registry/list getter and the
host has no public instance link. Its `genomechange` event occurs only after the
reference has loaded. Recovering that partial instance needs a library change;
calling `removeAllBrowsers` would also destroy an unrelated live viewer. This
failure path therefore remains open. A late disposal exception is observed and
reported with a fixed message, without leaking the thrown error's contents or
leaving the fulfilled creation chain with an unhandled rejection.


The subsequent [pinned native cleanup change](igv-native-initialization-patch-assessment-20260922.md)
addresses that measured reference-read rejection inside both installed library
entry builds. Its original failure receipt above remains historical evidence;
the native comparison and maintained tests verify the corrected path while
preserving a different live viewer. Constructor and secondary-disposal failures
remain outside the measured claim.
