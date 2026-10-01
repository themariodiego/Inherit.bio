# Optional Future Person matching details

Checkpoint dated 1 October 2026. This implements the profile prerequisite
registered as `api.future-person-identity-profile`, under the existing
TEST-LOCAL availability boundary. Production availability remains closed.

The brief §4 makes the child's date and place of birth and parent names
optional parent-supplied matching details. The Record Key Card identifies a
record independently of those details. Only one exact current genetic-parent
member of the basis resolver's record-key recipient set can save them, with
that same person's current `consent.upload-embryo` signature. Deleting them
uses current parent/recipient authority without requiring a new signature or
`embryo_analysis` permission. A supplied owner, donor, uploader, reviewer or
stale recipient grants no authority.

The server normalizes and encrypts only the closed registered fields. Each
new profile has a random separately wrapped data key authenticated to its
profile UUID, embryo UUID and identity revision. Purpose-separated keyed
match indexes use the existing externally held root/keyring infrastructure,
retain every held revision, and expose no plaintext or index to the client.
Retiring a still-needed root is refused until the replacement index exists.
No extra owner secret, profile cache, parallel profile table, document copy or
foreign key is introduced. All existing account, parent and claimant exports
exclude this protected table, and the existing exact subject erasure selector
removes its entire row.

A profile copies the sole live committed transferred claim-window deadline.
Replacement never extends it. Save/delete serialize on the subject before
rechecking every exact authority and profile revision. The page's prospective
operation and independent CSRF proofs are stateless and expire within ten
minutes or that original deadline; only the mutation transaction consumes the
nonce hash. Replacement, deletion, lost parent control and due expiry destroy
the wrapper and physically remove every index and ciphertext in that same
transaction. The bounded retention executor preserves the original generic
queues and deadlines even after its own failure. Automated erasure records
only an unattributed coded event; explicit parent actions can use the current
own-session audit actor through the existing closed issuer.

Legacy profiles keep their original bytes and NULL proof fields. They are
never upgraded, matched or opened through a derived-key fallback. For a Card
review without a legacy profile, the assigned recent-MFA human reviewer can
receive only actual earlier signing-name ciphertext from the genuine frozen
parentage signatures. The server opens those historical names with the
existing signing envelope; it never copies a current name or invents parent
identity evidence. The public reviewer DTO keeps its original closed shape.

The focused runtime tests prove the real cryptographic envelopes, exact
request/response boundaries and stateless operation bindings. The new SQL
fixture awaits the coordinator's fresh database rehearsal, and no profile UI
or keyless browser execution is claimed by this prerequisite checkpoint.
Actual keyless documentary matching still requires both independently keyed,
clean documents, their complete delivery receipts and explicit named-human
attestation. The actual delivered owner notice must start the registered
30-day objection window, followed by a fresh authorized human release
transaction; elapsed time alone never releases a record. Those actions remain
closed until implemented and proved. G5.4 and G4.2 remain unaccepted.

## Settings control follow-up

The controls are offered on the existing authenticated `/settings/data` page,
independently of an analytical grant. `profileAfter` is a canonical UUID cursor
for a read-only, bounded current-parent record inventory. The page renders
stateless prospective proofs and writes no nonce, session or profile during a
GET. It paginates every remaining candidate record rather than truncating the
set. A stranger, stale parent or crossed own Auth session receives no control;
unsupported current authority is withheld. The actual mutation recomputes the
complete receipt under the subject lock before consuming its nonce.

Saved profile values are never loaded into the settings page or form. The
native inputs start blank, use no local storage or sensitive cache, and clear
after a confirmed successful save or deletion. The client requires the exact
closed successful response and original deadline; an uncertain response asks
for a fresh page without claiming that a change failed to commit. A current
parent's deletion control remains available without signing new upload
consent. Account export and account deletion retain their top-level position.

The strict runtime loader checks pass. Fresh SQL and native browser execution
remain pending. A source review found that the existing embryo detail path
requires `embryo_analysis`, and no page currently renders the implemented
disposition endpoint's prospective nonce or native propose/confirm controls.
A separate narrow parent rights control is therefore required to reach a real
transferred record through the product before profile browser proof. No
matching authority or operation proof will be fabricated in a fixture.
