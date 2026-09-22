# Upload after viewing a genome · 22 September 2026

The embedded genome viewer installed a permanent patch on the document's
`XMLHttpRequest` prototype. It refused every cross-origin request, including
the uploader's ordinary request to the private Supabase store. Client-side
navigation kept that patch alive after leaving the viewer. A full page reload
hid the defect, which is why upload tests starting with `page.goto` missed it.

An isolated Chromium probe ran the exact old guard and sent synthetic bytes to
a fulfilled test origin: it produced a network error and the request never
reached the test transport. The probe then used the installed viewer with a
native `File` reference: it rendered without external genome requests and the
same synthetic upload received HTTP 200. This is a browser isolation test,
not a hosted Storage measurement or a large-file capacity result.

The viewer now receives a native `File` containing the public chromosome sizes
fetched from this site's fixed path. The installed library's File reader skips
its external URL-mapping lookup; default genome discovery remains disabled.
The viewer's fallback web search and URL-supplied track/session configuration
are explicitly disabled too. Unknown position names stay local, while the
page's own authenticated search continues to resolve named positions.
Inline variant features still come from the account-scoped region endpoint.
The component no longer replaces the page's network methods. Reference
redirects and failed responses are refused, and reference/region fetches are
cancelled when the component unmounts.

Four new Chromium regressions exercise the actual installed viewer, unchanged
network methods, synthetic cross-origin uploads while mounted and after native
removal, reference refusal, redirect refusal and cancellation. The existing
full-app network journey now follows actual My Genome and Add a file links,
asserts that the document was retained, and sends another synthetic file
through real Storage, finalization and preparation. Its existing origin and
tracker assertions remain, and also cover that second upload.

The 58 focused reference, widget, control-count, keyboard and copy checks pass.
Complete app execution remains required in CI.
No upload transport, file-size ceiling, preparation budget, route ratchet or
density threshold changes. This does not prove large-file capacity, resolve
all viewer lifecycle cases, or close G1.13b.
