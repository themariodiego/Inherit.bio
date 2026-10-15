# Account deletion and held uploads

The account release's actual source inventory contains152 stores. Two of them
come from the held-upload path: `public.other_adult_held_uploads` and
`private.path_b_report_bindings`. This source step keeps those account graphs
closed until a complete exact selector and physical provider acknowledgement
contract exists. It does not claim Path B account disposal is complete.

Migration030 checks original uploader, actual subject/account/principal and
report recipient/signing/directional endpoints separately, including unfinished
uploads and terminal retained records. A fresh Auth check precedes the graph
check; the graph check precedes nonce recording and every hold/notice write.
The v1 request and existing final graph check keep the same refusal. Exact
predecessor full bodies, argument/return ABI, owner, configuration and ACLs
are guarded and preserved. The internal selector has no API execution door.

The existing retention route first terminalizes held revisions, then invokes
the existing upload-working cleanup. `end_path_b_normalized_revision_v1` removes
a normalized descriptor; queued report cancellation removes its own binding.
Neither operation supplies physical disposal acknowledgement. The eventual
executor must preserve exact original working handles and all immutable
provider inventories until actual ACK, scope uploader and subject/recipient
rights independently, and preserve every foreign record. It must also handle
retained drafts, signatures, invitations, current/historical grants and the
bound person's legacy terminal principal rather than nulling ownership columns.

The SQL fixture uses the registered synthetic source setup and actual signatures,
held publication, permission and normalization/queued-report producers. Whole
registered graph/Auth/Storage equality and zero nonce/hold changes must hold on
both actors' native refusals. Complete database and browser execution is pending;
no acceptance or provider credit is claimed by authoring this checkpoint.
