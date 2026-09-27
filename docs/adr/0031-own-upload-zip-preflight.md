# ADR-0031 — Open single-file own-DNA ZIP downloads locally

Date: 22 September 2026. Status: Accepted for draft implementation; unreleased.
Authority: the owner's request to make the Overview and My Genome flows accept
relevant file formats. This narrowly extends ADR-0016's browser input handling;
server genetic formats, consent, authority and transport bounds do not change.

## Decision

Consumer downloads commonly wrap raw DNA text in a ZIP. Requiring people to
extract those manually leaves an avoidable failure before the supported text
parser. The own-DNA picker may open one regular, unencrypted ZIP member in
ephemeral browser memory. It supports stored and deflated members, including
matching streamed data descriptors. Local and central metadata, exact decoded
length and CRC32 must agree. Split, ZIP64, multiple-entry, empty, encrypted,
symlink, ambiguous, nested and malformed archives are refused before issuance.
No archive path is extracted to disk, and names and comments are not uploaded.

`payloadBoundaryContract.ownZipPreflightMaximumBytes` owns the additional
64 MiB local bound for both the selected archive and its contained file. The
format's live deployment ceiling also applies. The fixed cap bounds retained
browser data even if a future deployment admits much larger direct files. It
is not a throughput measurement, a minimum browser-memory requirement, or an
increase to an existing server limit. Larger archives can be extracted by the
person and their contained DNA files selected under the normal upload limits.

Before selection the page says that it opens ZIPs on the person's device and
saves only the file inside. That exact contained file becomes the source for
the existing full hash, lease, immutable stored original and download. Its DNA
content is not converted or normalized locally. If it is gzip, the gzip bytes
remain intact and existing complete server decompression limits apply. The
container itself is neither an uploaded source nor a retained original.

The existing browser detector still refuses PDFs, unsupported formats and
cohort-shaped data. Independent server validation still establishes complete
byte integrity, decoded size and single-sample structure. A malicious client
cannot use the local archive operation as a substitute for those checks.

## Alternatives

- Continuing to require manual extraction keeps the existing user obstacle.
- Server-side archive storage and extraction would require a new stored-source
  representation across finalization, normalization, hosted preparation and
  original download. It is unnecessary for the ordinary single-file download.
- Selecting one file from a multi-member archive risks silently choosing the
  wrong person's dataset. This implementation refuses rather than guesses.

## Verification

Unit tests check metadata disagreement, encryption, symlinks, corruption,
truncation, exact size bounds and false small sizes. Browser upload tests bind
the declaration and request body to the contained bytes. The full browser
matrix adds ZIP cases for every supported own content representation.
A standalone Chromium decoder probe also round-tripped 24 MiB of invented
bytes and refused a one-byte-over configured bound; it is not a hosted genetic
preparation or memory-capacity proof.

ZIP field semantics follow PKWARE APPNOTE 6.3.10, sections 4.3.7–4.3.16,
read 22 September 2026.
