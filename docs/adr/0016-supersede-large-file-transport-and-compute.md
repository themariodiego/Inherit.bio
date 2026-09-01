# ADR-0016 — Supersede large-file transport, formats, and compute placement

- Status: **Accepted** · 2026-08-31
- Deciders: Inherit engineering
- Supersedes: ADR-0001 in full

## Context

The original decision treated provider limits and an illustrative deployment
plan as product contracts. It required direct TUS upload in 6 MiB chunks,
signed-URL downloads, demo-only size caps, and BAM/CRAM storage plus a Tier-3
FASTQ worker. The later security and embryo-data contracts instead require
operation-scoped authorization, revocation between chunks, closed genetic
formats, and server-side embryo sanitization before durable storage.

Those models cannot both be canonical. This superseding decision resolves the
conflict before implementation.

## Decision

`docs/route-register.json` is the single authority for the numeric and
behavioral decisions governing genetic-file transport, storage, download, and
format eligibility. Fixed values live in the registered contracts; the direct
self/adult object cap is the server-resolved format-and-account limit returned
as
`responseContracts.upload-session-v1.oneOfClosedBodies[transport=direct-storage].maximumBytes`,
not a prose cap. In particular:

- `payloadBoundaryContract` owns every fixed function-body, ingest-chunk,
  embryo/evidence-session, document, record, line, sample-column, and
  concurrency limit.
- `policyContracts.genetic-file-ingest-v1` owns the closed allowed-format
  lists, target-format matrix, browser and server sniffing, structural
  validation, unknown-build handling, and fail-closed dispositions.
- `storageAccessContracts.genomes-server-mediated-v1` and
  `storageAccessContracts.restricted-evidence-v1` own client-versus-service
  Storage authority, object-key secrecy, finalization, and read mediation.
- `downloadContracts.revocable-chunk-session-v1` owns download credentials,
  chunking, per-chunk authorization, Storage reads, revocation, and caching.
  `largeExportDeliveryContract` owns the corresponding archive creation,
  readiness, open-ready, and delivery sequence.

This ADR records why those registered contracts control. Values repeated here
are a snapshot for comprehension, not a second source of truth. The
`policyContracts.genetic-file-ingest-v1.limitsSource` reference to this ADR is
traceability only; it does not transfer numeric authority out of
`payloadBoundaryContract`.

### Payload boundary

The accepted server ingest and download chunk is **4,000,000 bytes**. The
registered observed serverless body ceiling is 4,500,000 bytes, leaving the
chunk below that ceiling. A request or response larger than the registered
ceiling may not cross a Vercel Function.

Embryo input is browser-decompressed and framed as complete logical lines into
sequential same-origin requests. Every chunk is independently authenticated,
reparsed, and reserialized by the server; client normalization is never
trusted. Legal evidence uses the same bounded server-chunk pattern under its
separate registered session limits.

There is no architectural 6 MiB chunk, public-demo cap, Free-plan cap, or
`NEXT_PUBLIC_MAX_*_BYTES` authority. Embryo/evidence surfaces consume the fixed
registered values. A direct self/adult upload surface consumes the
server-clamped `maximumBytes` from its current upload-session response. Neither
path may invent a second limit.

### Upload and durable storage

Self and other-adult files may travel from the browser to private Supabase
Storage only under the exact short-lived, non-refreshable, database-authorized
upload session and create-only staging key defined by
`genomes-server-mediated-v1`. That narrowly scoped insert does not authorize a
read, list, update, upsert, second insert, final object, processing job, or
genetic interpretation. Finalization independently streams the complete
staging object, validates size, hash, structure, and magic bytes, copies it to
a fresh server-only immutable key, and deletes the staging key.

Embryo and cohort bytes never use that client Storage path. They cross the
registered same-origin embryo-ingest routes as bounded transport input. The
server accepts only sanitized autosomal fragments under a server-generated
name, and only the validated autosomal canonical source may be published to
persistent Storage. Original source labels, sex-linked fields, forbidden
headers, and rejected input do not become durable objects or genetic rows.

Direct TUS is not a product requirement, the provider's 6 MiB TUS chunk is not
an Inherit limit, and signed upload object URLs are not an allowed substitute
for the registered upload capability.

### Closed genetic formats

The accepted global allowlist is the exact
`policyContracts.genetic-file-ingest-v1.allowedDataFormats` set:

- `consumer-array-text-v1`, `consumer-array-text-v2`, `consumer-array-text-v3`, and `consumer-array-text-v4`
- `VCF`, `VCF.GZ`, and `gVCF`
- `pgt_table`

The target matrix is also closed. Subject uploads accept the four consumer
text formats and the three VCF-family formats. Cohort ingest accepts only the
three VCF-family formats and `pgt_table`. A subject-shaped session cannot
accept `pgt_table`, and a cohort-shaped or multisample input cannot be smuggled
through a subject declaration.

PDF, FASTQ, BAM, CRAM, an unrecognized genetic format, and an archive bomb are
not accepted genetic inputs. The browser performs an early magic-byte check
for usability, but the server independently sniffs and validates the decoded
bytes and owns the result. Rejection deletes partial or bypassed input under
the registered disposition and creates no derived genetic row.

For embryo/cohort input, the autosomal-only contract rejects forbidden
sex/gender/karyotype/proxy headers and retains only chromosomes 1–22. X, Y, M,
MT, PAR, unplaced, and unknown contigs are discarded without persisting or
reporting their presence or count. Only neutral server-issued sample ordinals
or random handles survive the transient mapping process.

### Download and export delivery

Originals, evidence, and generated archives are private and server-mediated.
An authorized entry route returns only a small descriptor for a
principal-and-object-bound, revocable download session. The browser then asks
`api.download-chunk` for canonical sequences in order. Each response is at
most the registered 4,000,000-byte chunk, and every request rechecks the live
principal, target, publication, lifecycle, grant, and originating-session
revisions before reading the exact server-computed Storage range.

The browser streams those chunks to a download sink and verifies the final
size and SHA-256. It never receives a full-file function response, bucket key,
arbitrary range capability, direct Storage URL, or signed object URL. Signed
URLs are rejected because they cannot provide the required on-demand
revocation and per-chunk authorization.

Large exports are created only by the registered explicit nonce-protected
POST, stored privately by a worker, and opened only by the separate explicit
`open-ready` POST after a read-only readiness poll. Their bytes use the same
revocable chunk contract.

### Compute placement

File processing and worker execution may run only through the operations,
authorization resolvers, enqueue contracts, and worker rechecks registered in
`docs/route-register.json`. No format is accepted merely because an external
or self-hosted worker could theoretically process it. Alignment, variant
calling, BAM/CRAM storage, FASTQ ingestion, and a Tier-3 worker are outside the
accepted product contract unless a later ADR and route-register change add a
closed format, authority, lifecycle, and verified execution path.

## Superseded claims

The following claims from the prior ADR are rejected and must not appear as
current product behavior or implementation guidance:

- all uploads use browser-to-Storage TUS with exactly 6 MiB chunks;
- downloads use short-lived signed URLs or redirect to Storage;
- demo limits are 100 MB, 200 MB, 5 GB, or the active Supabase plan's object
  limit;
- BAM and CRAM form a stored Tier 2;
- FASTQ or BAM/CRAM analysis forms a self-hosted Tier 3;
- a browser-only hash or format preflight is sufficient server authority; and
- embryo/cohort source bytes may be durably stored before server autosomal
  sanitization and closed-format validation.

## Consequences

- There is one machine-readable decision path for each byte limit and
  transport rule: fixed caps resolve from `payloadBoundaryContract`, while the
  direct self/adult cap resolves server-side and is returned by the current
  upload session. Tests and copy consume those decisions rather than this
  prose.
- Ordinary self/adult upload remains possible without routing the full object
  through a Vercel Function, but Storage insertion is a one-object staging
  capability rather than general Storage access.
- Embryo ingest intentionally trades direct provider upload for bounded
  same-origin sanitization so prohibited source fields never become durable.
- Download revocation can take effect before the next chunk and no bearer URL
  remains valid outside the application decision path.
- Product copy lists only the closed accepted formats and never advertises
  BAM, CRAM, FASTQ, tier labels, or plan-dependent demo caps.
- A future transport, format, or compute expansion requires both a superseding
  accepted ADR and a coherent route-register change; prose alone cannot add
  capability.
