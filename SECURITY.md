# Security policy

Inherit stores genetic data. A defect here is not an inconvenience; it is a
disclosure of the most identifying data a person has. We treat reports
accordingly.

## Reporting a vulnerability

Email **security@inherit.bio**. This is the same contact published in
[`/.well-known/security.txt`](https://www.inherit.bio/.well-known/security.txt),
and the full policy is at
[inherit.bio/legal/incident-response](https://www.inherit.bio/legal/incident-response).

Please do **not** open a public issue for a security defect.

In your first message, include:

- the affected URL or code path
- what you found, and the steps that reproduce it
- the smallest safe example
- a way for us to reply

Please do **not** include genome data, passwords, access keys, or any other
private information. The published security file does not yet name an encryption
key, so assume the message is not encrypted in transit to us.

Do not test against another person's account or data. If a defect can only be
demonstrated with real genetic data, say so and we will work out a safe
reproduction together — do not send the data.

## What we commit to

- We confirm receipt when the mailbox is working. A missing reply is never
  permission to collect more data, retain access, or disclose publicly.
- We tell you what we found and what we changed.
- We credit reporters who want credit, and respect those who do not.

## Scope

In scope: this repository, and the hosted service at `inherit.bio`.

Out of scope: the genome-sequencing providers listed in the provider directory.
Inherit never sells sequencing and never takes payment for it — those are
independent companies, and reports about their systems should go to them
directly.

## Self-hosting

Inherit is designed to be self-hosted (see
[`docs/self-hosting.md`](docs/self-hosting.md)). If you run your own instance,
you own its security posture: your Supabase keys, your storage, your
[BYOK](README.md) provider credentials. The Row Level Security policies and the
tests that prove them (`e2e/rls.spec.ts`) ship with the repository — run them
against your own deployment.

## Supported versions

This project ships from `main`. Security fixes land on `main` and are deployed to
the hosted service; there are no separately maintained release branches.
