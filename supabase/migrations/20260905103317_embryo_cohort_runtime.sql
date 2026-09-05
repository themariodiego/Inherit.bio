-- Embryo cohort runtime (E0, slice 1 of 3).
--
-- What this migration adds, in dependency order:
--   1. the six legal artifacts an embryo cohort needs, seeded verbatim from
--      content/legal/<key>/v1.md (a vitest drift test keeps file and seed
--      equal);
--   2. small schema additions: a relaxed principal identity check so an
--      invited genetic parent can exist before they accept, the
--      disposition-rights attestation kind, the draft's upload situation,
--      cohort publication and ingest revisions, per-embryo closing-date and
--      disposition timestamps, the print right's delivery kind, and the
--      embryo operation nonce store;
--   3. private helpers: nonce consumption, the Record Key generator, the
--      basis-authority resolver (policyResolvers.embryo-basis-authority-v1),
--      set readers and the principal mail helper;
--   4. the route-callable RPCs for drafts, artifact signatures, co-parent
--      invitations, rights-session activation and acceptance, cohort
--      finalization, Record Key Card delivery, restriction, disposition and
--      the cohort embryo.analysis grant;
--   5. job_time_stats, the draft-expiry retention executor and the
--      forbidden-column guard.
--
-- Every RPC is security definer with an empty search_path, revoked from
-- anon/authenticated and executable by service_role only (job_time_stats is
-- the one authenticated-readable function). Every state-changing RPC records
-- the SHA-256 of its one-time operation nonce before any other write, so a
-- replayed request fails with 23505 and zero side effect. Error codes follow
-- the repository convention: 42501 authority or unreadable target, 22023
-- invalid input, 23505 nonce reuse, 55000 state, 23514 shape.
--
-- No retention registry row is added: retention_rows, retention_due_phases
-- and purge_manifests are inserted against the registered IDs only.

-- ---------------------------------------------------------------------------
-- 1. Legal artifacts (bodies are the content/legal files, verbatim)
-- ---------------------------------------------------------------------------

insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on
)
select
  'consent.upload-embryo',
  1,
  encode(extensions.digest(convert_to('What this consent is:

This consent lets Inherit store genetic files about a group of embryos and analyse them only when every required person has agreed. Until then the files stay in quarantine. It is signed by each genetic parent who can sign, or by the one person who alone holds the legal right to decide for the embryos. Where someone who is not a genetic parent uploads the files, that person signs the uploader statements as well.

What Inherit can and cannot tell you:

No child anywhere has been born and followed up after embryos were compared this way. There is no outcome data. Every number on this page is a simulation.

Inherit cannot verify who you are or whose embryos these are. It records exactly what you tell it, keeps that record, and gives the other genetic parent a real way to stop it.

The Future Person Charter is part of this consent:

The Future Person Charter is part of this consent as if it were written out here. You can read it at /legal/future-person. The person who may be born from any of these embryos is an intended beneficiary of rights 1 to 6 of the Charter. That person may enforce those rights against Inherit in their own name. For England and Wales, the Contracts (Rights of Third Parties) Act 1999 applies to this clause and is not excluded.

Where one parent was a donor:

A gamete donor cannot consent here and has not. Inherit will not attempt to identify a donor, and will not report on relatives found in your data.

What a genetic parent confirms:

1. I am a genetic parent of these embryos, or I alone hold the legal right to decide what happens to them.

2. I understand that there is no outcome data, and that every number Inherit shows about an embryo is a simulation.

3. I have read the Future Person Charter in full, and I accept that it is part of this consent.

4. I can withdraw at any time without giving a reason. Inherit then stops all analysis of these embryos and deletes what it built from the files.

What an uploader who is not a genetic parent confirms:

5. I have the right to hold these files and to give them to Inherit.

6. I am not a genetic parent of these embryos.

7. Both genetic parents have given me permission to upload these embryos to Inherit, and I can show that permission if asked.

Statement 4 applies to an uploader too, and an uploader signs it.

What a genetic parent confirms to allow analysis:

8. This agreement covers one purpose only: analysis of these embryos on Inherit. It switches nothing else on.

9. Analysis runs only while every genetic parent named on the record has agreed to it. If one of us stops it, it stops for all of us.

10. I can pause or stop this at any time. Inherit then stops analysis, and its results become unreachable.

What Inherit will never do:

Inherit will not train, tune, calibrate or benchmark any model on embryo data. It will not make de-identified or aggregated copies of it. It will not sell it, share it with an insurer, an employer or a school, or send it to an outside AI company.

How you sign:

You sign by typing your full legal name. Inherit stamps the date. Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.', 'UTF8'), 'sha256'), 'hex'),
  'What this consent is:

This consent lets Inherit store genetic files about a group of embryos and analyse them only when every required person has agreed. Until then the files stay in quarantine. It is signed by each genetic parent who can sign, or by the one person who alone holds the legal right to decide for the embryos. Where someone who is not a genetic parent uploads the files, that person signs the uploader statements as well.

What Inherit can and cannot tell you:

No child anywhere has been born and followed up after embryos were compared this way. There is no outcome data. Every number on this page is a simulation.

Inherit cannot verify who you are or whose embryos these are. It records exactly what you tell it, keeps that record, and gives the other genetic parent a real way to stop it.

The Future Person Charter is part of this consent:

The Future Person Charter is part of this consent as if it were written out here. You can read it at /legal/future-person. The person who may be born from any of these embryos is an intended beneficiary of rights 1 to 6 of the Charter. That person may enforce those rights against Inherit in their own name. For England and Wales, the Contracts (Rights of Third Parties) Act 1999 applies to this clause and is not excluded.

Where one parent was a donor:

A gamete donor cannot consent here and has not. Inherit will not attempt to identify a donor, and will not report on relatives found in your data.

What a genetic parent confirms:

1. I am a genetic parent of these embryos, or I alone hold the legal right to decide what happens to them.

2. I understand that there is no outcome data, and that every number Inherit shows about an embryo is a simulation.

3. I have read the Future Person Charter in full, and I accept that it is part of this consent.

4. I can withdraw at any time without giving a reason. Inherit then stops all analysis of these embryos and deletes what it built from the files.

What an uploader who is not a genetic parent confirms:

5. I have the right to hold these files and to give them to Inherit.

6. I am not a genetic parent of these embryos.

7. Both genetic parents have given me permission to upload these embryos to Inherit, and I can show that permission if asked.

Statement 4 applies to an uploader too, and an uploader signs it.

What a genetic parent confirms to allow analysis:

8. This agreement covers one purpose only: analysis of these embryos on Inherit. It switches nothing else on.

9. Analysis runs only while every genetic parent named on the record has agreed to it. If one of us stops it, it stops for all of us.

10. I can pause or stop this at any time. Inherit then stops analysis, and its results become unreachable.

What Inherit will never do:

Inherit will not train, tune, calibrate or benchmark any model on embryo data. It will not make de-identified or aggregated copies of it. It will not sell it, share it with an insurer, an employer or a school, or send it to an outside AI company.

How you sign:

You sign by typing your full legal name. Inherit stamps the date. Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.',
  'This consent lets Inherit store genetic files about embryos. Nothing is analysed until every genetic parent named on the record has signed. No child has ever been followed up after embryos were compared this way, so every number Inherit shows is a simulation. The person who may be born from an embryo gets six rights under the Future Person Charter, and that person can enforce them. You can withdraw at any time, and Inherit then stops and deletes. Signing something that is not true may be a crime.',
  date '2026-09-05'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'consent.upload-embryo' and version = 1
);

insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on
)
select
  'attestation.embryo-parentage',
  1,
  encode(extensions.digest(convert_to('What this attestation is:

An attestation is a statement of fact that you sign and that Inherit records but cannot check. This one is signed by each genetic parent of the embryos on the record. Inherit cannot verify who you are or whose embryos these are. It keeps a permanent record of exactly what you state here.

What you confirm:

1. I am a genetic parent of these embryos.

2. The other genetic parent is named truthfully on this record, or the reason no other parent can sign is stated truthfully.

3. I have read the warning about false statements at the end of this attestation, and I understand it.

If someone objects:

If anyone tells Inherit that they are a genetic parent of these embryos and did not agree, Inherit freezes the record within 60 seconds and tells both sides within 24 hours. Unless a dispute hold applies, Inherit then deletes the results and the files. A second contradiction on the same account permanently blocks that account from uploading DNA about anyone other than its holder. You can appeal at /legal/appeals.

How you sign:

You sign by typing your full legal name. Inherit stamps the date. Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.', 'UTF8'), 'sha256'), 'hex'),
  'What this attestation is:

An attestation is a statement of fact that you sign and that Inherit records but cannot check. This one is signed by each genetic parent of the embryos on the record. Inherit cannot verify who you are or whose embryos these are. It keeps a permanent record of exactly what you state here.

What you confirm:

1. I am a genetic parent of these embryos.

2. The other genetic parent is named truthfully on this record, or the reason no other parent can sign is stated truthfully.

3. I have read the warning about false statements at the end of this attestation, and I understand it.

If someone objects:

If anyone tells Inherit that they are a genetic parent of these embryos and did not agree, Inherit freezes the record within 60 seconds and tells both sides within 24 hours. Unless a dispute hold applies, Inherit then deletes the results and the files. A second contradiction on the same account permanently blocks that account from uploading DNA about anyone other than its holder. You can appeal at /legal/appeals.

How you sign:

You sign by typing your full legal name. Inherit stamps the date. Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.',
  'You are stating that you are a genetic parent of these embryos, and that the other genetic parent is named truthfully. Inherit cannot check this. It keeps a permanent record of what you state and gives the other parent a real way to object. A false statement here may be a crime.',
  date '2026-09-05'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'attestation.embryo-parentage' and version = 1
);

insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on
)
select
  'attestation.embryo-disposition-rights',
  1,
  encode(extensions.digest(convert_to('What this attestation is:

Disposition means what happens to an embryo: it is stored, transferred to a womb, donated, or discarded. Inherit records a disposition only from a person who has the right to decide it. Inherit cannot check that right. It records what you state here and keeps that record.

What you confirm:

1. I have the right to decide the disposition of these embryos, alone or together with the other genetic parent named on this record.

2. There is no dispute about these embryos, and no court case or other legal proceeding about them that I know of.

3. I understand that if anyone with a claim to these embryos objects, Inherit stops and deletes.

How a disposition is recorded:

Where two genetic parents are on the record, one proposes a disposition and the other confirms it. A proposal that is not confirmed within 7 days lapses. Where one person alone holds the right to decide, that person records the disposition directly. Every genetic parent on the record is told when a disposition is recorded.

What each disposition means for the data:

Stored, or not yet decided: Inherit keeps the record for 24 months after the last analysis, or after the upload if there was none, and then deletes it. Donated or discarded: Inherit deletes the record 90 days after the disposition is recorded. Transferred: the record is reserved for the person who may be born. No new analysis runs unless a parent turns it on again. The record is kept until 18 years and 9 months after the transfer, plus 24 months. It is then deleted if nobody has claimed it. A parent may delete it earlier.

How you sign:

You sign by typing your full legal name. Inherit stamps the date. Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.', 'UTF8'), 'sha256'), 'hex'),
  'What this attestation is:

Disposition means what happens to an embryo: it is stored, transferred to a womb, donated, or discarded. Inherit records a disposition only from a person who has the right to decide it. Inherit cannot check that right. It records what you state here and keeps that record.

What you confirm:

1. I have the right to decide the disposition of these embryos, alone or together with the other genetic parent named on this record.

2. There is no dispute about these embryos, and no court case or other legal proceeding about them that I know of.

3. I understand that if anyone with a claim to these embryos objects, Inherit stops and deletes.

How a disposition is recorded:

Where two genetic parents are on the record, one proposes a disposition and the other confirms it. A proposal that is not confirmed within 7 days lapses. Where one person alone holds the right to decide, that person records the disposition directly. Every genetic parent on the record is told when a disposition is recorded.

What each disposition means for the data:

Stored, or not yet decided: Inherit keeps the record for 24 months after the last analysis, or after the upload if there was none, and then deletes it. Donated or discarded: Inherit deletes the record 90 days after the disposition is recorded. Transferred: the record is reserved for the person who may be born. No new analysis runs unless a parent turns it on again. The record is kept until 18 years and 9 months after the transfer, plus 24 months. It is then deleted if nobody has claimed it. A parent may delete it earlier.

How you sign:

You sign by typing your full legal name. Inherit stamps the date. Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.',
  'Disposition means what happens to an embryo: it is stored, transferred, donated or discarded. You are stating that you have the right to decide this, alone or with the other genetic parent, and that nobody is disputing it. If anyone with a claim objects, Inherit stops and deletes. A false statement here may be a crime.',
  date '2026-09-05'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'attestation.embryo-disposition-rights' and version = 1
);

insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on
)
select
  'attestation.embryo-single-parent-basis',
  1,
  encode(extensions.digest(convert_to('What this attestation is:

Inherit normally needs both genetic parents to sign for themselves, each in their own account. A bare statement by one person that both parents agree is never enough. This attestation covers the three cases where only one person can sign. Inherit records what you state here, keeps that record, and cannot check it.

The three cases:

An anonymous gamete donor. A gamete donor cannot consent here and has not. Inherit will not attempt to identify a donor, and will not report on relatives found in your data.

A genetic parent who has died. Inherit asks for the death certificate. A named person reviews it. No computer approves it.

One person alone holds the legal right to decide for the embryos. Inherit asks for the clinic''s or the court''s document that gives you that right. A named person reviews it. Inherit is not able to judge a family dispute. If the other genetic parent tells us they object, we stop and delete.

Where parentage is contested, or a legal proceeding about the embryos is under way, Inherit refuses the upload.

What you confirm:

1. The reason I have given for why only one person can sign is true.

2. Every document I provide to show this is genuine and complete, and I have not altered it.

3. I understand that if the other genetic parent, or anyone who says they are one, objects, Inherit stops analysis and deletes.

If someone objects:

An objection from anyone who says they are a genetic parent freezes the record within 60 seconds, pending review. If the review is not resolved within 30 days, Inherit deletes the record.

How you sign:

You sign by typing your full legal name. Inherit stamps the date. Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.', 'UTF8'), 'sha256'), 'hex'),
  'What this attestation is:

Inherit normally needs both genetic parents to sign for themselves, each in their own account. A bare statement by one person that both parents agree is never enough. This attestation covers the three cases where only one person can sign. Inherit records what you state here, keeps that record, and cannot check it.

The three cases:

An anonymous gamete donor. A gamete donor cannot consent here and has not. Inherit will not attempt to identify a donor, and will not report on relatives found in your data.

A genetic parent who has died. Inherit asks for the death certificate. A named person reviews it. No computer approves it.

One person alone holds the legal right to decide for the embryos. Inherit asks for the clinic''s or the court''s document that gives you that right. A named person reviews it. Inherit is not able to judge a family dispute. If the other genetic parent tells us they object, we stop and delete.

Where parentage is contested, or a legal proceeding about the embryos is under way, Inherit refuses the upload.

What you confirm:

1. The reason I have given for why only one person can sign is true.

2. Every document I provide to show this is genuine and complete, and I have not altered it.

3. I understand that if the other genetic parent, or anyone who says they are one, objects, Inherit stops analysis and deletes.

If someone objects:

An objection from anyone who says they are a genetic parent freezes the record within 60 seconds, pending review. If the review is not resolved within 30 days, Inherit deletes the record.

How you sign:

You sign by typing your full legal name. Inherit stamps the date. Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm.',
  'Normally both genetic parents must sign for themselves. You are stating why only one person can sign. The other parent was an anonymous donor, has died, or you alone hold the legal right to decide. Inherit cannot judge a family dispute. If the other genetic parent objects, Inherit stops and deletes. A false statement here may be a crime.',
  date '2026-09-05'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'attestation.embryo-single-parent-basis' and version = 1
);

insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on
)
select
  'charter.future-person',
  1,
  encode(extensions.digest(convert_to('Who this Charter is for:

This Charter is written to the person who may be born from an embryo whose record is held on Inherit. That person was not party to any agreement about the record. A parent or uploader signs this Charter now. The rights in it belong to the person who may be born, and nobody can sign them away.

Your six rights:

Right 1. The record is yours. When you turn 18, you can ask us for everything we hold about the embryo you came from. This includes every result and the full record of who agreed to what. It is free. We give it in a format you can read and one a scientist can read. We will not include your parents'' own DNA results unless they agree separately. Those results are also about them.

Right 2. You can have it corrected.

Right 3. You can have it deleted completely, and we will do it within 30 days. You do not have to give a reason. Nobody, including your parents, can stop you. We keep one line saying a deletion happened. It has no name or identifier that points back to you.

Right 4. You can tell us never to analyse it again and keep the copy you have.

Right 5. We will never sell it. We will never share it with an insurer, an employer, or a school. We will never send it to an outside AI company. We will never hand it to anyone without a court order that we first tried to resist. For anyone''s genome but your own, Copilot only runs on a model you host yourself. Nothing leaves Inherit.

Right 6. We keep the record until you are 20. You can claim it for free at /future-person/claim any time before then. If no one has claimed it by then, we delete it. Keeping a genetic record about someone who never asked for it is worse than losing it.

These rights can be enforced:

The person who may be born from the embryo is an intended beneficiary of rights one through six. That person may enforce these rights.

For England and Wales, our upload consent and terms state that the Contracts (Rights of Third Parties) Act 1999 applies to this promise and is not excluded. Elsewhere, embryo service stays off until a lawyer confirms this route works or records another way to make the rights effective.

What a claim can include:

A release can include only the claimed embryo subject''s variant calls, results, consent signatures, attestations, legal audit slice, and provenance. It cannot include another subject''s variant rows. It cannot include a parent''s own DNA results unless that parent agrees separately.

If a donor was used:

If you were conceived with a donor''s egg or sperm, the record may show that. Inherit will not attempt to identify a donor, and will not report on relatives found in the record.

The Record Key Card:

At upload, each parent on the record gets a printable Record Key Card for each embryo. It carries a 20-character claim key, the claim address, and the date the record closes, in words and as a date. Inherit keeps only a hash of the key. Parents: keep the card for the child. Without it, a claim needs a photo identity document and a birth record, checked by a named reviewer, and the record holder is told 30 days before any release. Without the card, and without details a parent supplied, we cannot tell which record is yours, and we will not guess.

What the parent signing this confirms:

1. I have read this Charter in full.

2. I understand that these rights belong to the person who may be born from these embryos, that they can enforce them, and that I cannot take them away.', 'UTF8'), 'sha256'), 'hex'),
  'Who this Charter is for:

This Charter is written to the person who may be born from an embryo whose record is held on Inherit. That person was not party to any agreement about the record. A parent or uploader signs this Charter now. The rights in it belong to the person who may be born, and nobody can sign them away.

Your six rights:

Right 1. The record is yours. When you turn 18, you can ask us for everything we hold about the embryo you came from. This includes every result and the full record of who agreed to what. It is free. We give it in a format you can read and one a scientist can read. We will not include your parents'' own DNA results unless they agree separately. Those results are also about them.

Right 2. You can have it corrected.

Right 3. You can have it deleted completely, and we will do it within 30 days. You do not have to give a reason. Nobody, including your parents, can stop you. We keep one line saying a deletion happened. It has no name or identifier that points back to you.

Right 4. You can tell us never to analyse it again and keep the copy you have.

Right 5. We will never sell it. We will never share it with an insurer, an employer, or a school. We will never send it to an outside AI company. We will never hand it to anyone without a court order that we first tried to resist. For anyone''s genome but your own, Copilot only runs on a model you host yourself. Nothing leaves Inherit.

Right 6. We keep the record until you are 20. You can claim it for free at /future-person/claim any time before then. If no one has claimed it by then, we delete it. Keeping a genetic record about someone who never asked for it is worse than losing it.

These rights can be enforced:

The person who may be born from the embryo is an intended beneficiary of rights one through six. That person may enforce these rights.

For England and Wales, our upload consent and terms state that the Contracts (Rights of Third Parties) Act 1999 applies to this promise and is not excluded. Elsewhere, embryo service stays off until a lawyer confirms this route works or records another way to make the rights effective.

What a claim can include:

A release can include only the claimed embryo subject''s variant calls, results, consent signatures, attestations, legal audit slice, and provenance. It cannot include another subject''s variant rows. It cannot include a parent''s own DNA results unless that parent agrees separately.

If a donor was used:

If you were conceived with a donor''s egg or sperm, the record may show that. Inherit will not attempt to identify a donor, and will not report on relatives found in the record.

The Record Key Card:

At upload, each parent on the record gets a printable Record Key Card for each embryo. It carries a 20-character claim key, the claim address, and the date the record closes, in words and as a date. Inherit keeps only a hash of the key. Parents: keep the card for the child. Without it, a claim needs a photo identity document and a birth record, checked by a named reviewer, and the record holder is told 30 days before any release. Without the card, and without details a parent supplied, we cannot tell which record is yours, and we will not guess.

What the parent signing this confirms:

1. I have read this Charter in full.

2. I understand that these rights belong to the person who may be born from these embryos, that they can enforce them, and that I cannot take them away.',
  'If an embryo record later becomes a record about you, it is yours. You can obtain it, correct it, stop analysis, or delete it. Inherit will not sell it or use it to rank lives. You can enforce these rights yourself. A parent signs this now to say they have read it and that the rights are yours.',
  date '2026-09-05'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'charter.future-person' and version = 1
);

insert into public.consent_artifacts (
  artifact_key, version, body_sha256, body_markdown, summary_markdown, effective_on
)
select
  'disclosure.insurance-and-discrimination',
  1,
  encode(extensions.digest(convert_to('Read this before any result is made:

GINA below means the US Genetic Information Nondiscrimination Act of 2008. Read more at /legal/gina.

A genetic result can be used against you. GINA stops health insurers, and employers with 15 or more staff, from using it. It does not cover smaller employers, and it does not stop life insurance, disability insurance or long-term care insurance companies. No federal law does.

Your result is also information about your parents, your siblings, your children and people you have never met. They did not agree to this. If one of them wants us to stop, they can tell us at /legal/appeals without an account, and we will.

Asking for a genetic test is itself genetic information under US employment law. Taking part can matter, not just the answer.

If you are thinking about life, disability or long-term care cover, get advice about the order in which to do things before you look at your results.

Some countries and some US states protect you more than others. See the list. It is at /legal/state-genetic-privacy for US states and /legal/where-inherit-works for countries.

A result about an embryo becomes, if a child is born, a fact about a living person who could not agree to it. That person''s rights are in the Future Person Charter at /legal/future-person.

This is general information, not legal advice.

What you confirm:

1. I have read this disclosure and I understand it.', 'UTF8'), 'sha256'), 'hex'),
  'Read this before any result is made:

GINA below means the US Genetic Information Nondiscrimination Act of 2008. Read more at /legal/gina.

A genetic result can be used against you. GINA stops health insurers, and employers with 15 or more staff, from using it. It does not cover smaller employers, and it does not stop life insurance, disability insurance or long-term care insurance companies. No federal law does.

Your result is also information about your parents, your siblings, your children and people you have never met. They did not agree to this. If one of them wants us to stop, they can tell us at /legal/appeals without an account, and we will.

Asking for a genetic test is itself genetic information under US employment law. Taking part can matter, not just the answer.

If you are thinking about life, disability or long-term care cover, get advice about the order in which to do things before you look at your results.

Some countries and some US states protect you more than others. See the list. It is at /legal/state-genetic-privacy for US states and /legal/where-inherit-works for countries.

A result about an embryo becomes, if a child is born, a fact about a living person who could not agree to it. That person''s rights are in the Future Person Charter at /legal/future-person.

This is general information, not legal advice.

What you confirm:

1. I have read this disclosure and I understand it.',
  'A genetic result can be used against you. The law protects you in some places and not in others. Your result is also about your relatives, who did not agree. A result about an embryo can become a fact about a child. Read this before you look at any result.',
  date '2026-09-05'
where not exists (
  select 1 from public.consent_artifacts
  where artifact_key = 'disclosure.insurance-and-discrimination' and version = 1
);

-- ---------------------------------------------------------------------------
-- 2. Schema additions
-- ---------------------------------------------------------------------------

-- An invited genetic parent is a principal before they hold an account: the
-- invitation mail, the contact reference and the draft slot all point at it.
-- Until acceptance it has neither subject nor account, and the draft-expiry
-- executor marks it deleted with both still null.
do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.subject_principals'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%reviewer%';
  if v_name is not null then
    execute format('alter table public.subject_principals drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.subject_principals
  add constraint subject_principals_identity_check check (
    subject_id is not null
    or account_id is not null
    or principal_kind in ('reviewer', 'service')
    or (
      principal_kind in ('genetic_parent', 'identified_donor')
      and status in ('pending', 'deleted')
    )
  );

do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.attestations'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%own_embryo%';
  if v_name is not null then
    execute format('alter table public.attestations drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.attestations
  add constraint attestations_kind_check check (kind in (
    'own_embryo', 'genetic_parent', 'parents_permission', 'jurisdiction',
    'single_parent_authority', 'adult_control', 'future_person_acknowledgement',
    'disposition_rights'
  ));

alter table public.embryo_cohort_drafts
  add column upload_situation text not null default 'own_embryos'
    check (upload_situation in ('own_embryos', 'with_genetic_parents_permission'));

alter table public.embryo_cohorts
  add column publication_revision bigint check (publication_revision > 0),
  add column ingest_revision bigint not null default 1 check (ingest_revision > 0);

-- The closing date printed on a Record Key Card. It is provisional until the
-- ingest worker resolves every ordinal, and definitive after a transfer.
alter table public.embryos
  add column closing_date date not null
    default (clock_timestamp() + interval '24 months')::date,
  add column closing_date_state text not null
    default 'provisional_until_terminal_ordinal_resolution'
    check (closing_date_state in (
      'provisional_until_terminal_ordinal_resolution',
      'definitive_stored_or_unknown',
      'definitive_transferred_claim_window'
    )),
  add column date_revision bigint not null default 1 check (date_revision > 0),
  add column disposition_effective_at timestamptz,
  add column transferred_at timestamptz;

alter table public.future_person_record_key_print_rights
  add column delivery_kind text not null default 'initial'
    check (delivery_kind in ('initial', 'transfer_replacement'));

-- Consumed one-time operation nonces. A row is written before any other
-- write of the operation it protects; the primary key makes a replay fail.
create table public.embryo_operation_nonces (
  nonce_hash text primary key check (nonce_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid references auth.users (id) on delete cascade,
  session_id uuid,
  operation text not null check (operation ~ '^[a-z_]{3,40}$'),
  target_kind text not null check (target_kind in (
    'account', 'cohort_draft', 'cohort', 'embryo', 'rights_session'
  )),
  target_id uuid,
  consumed_at timestamptz not null default clock_timestamp()
);

alter table public.embryo_operation_nonces enable row level security;
revoke all on table public.embryo_operation_nonces from public, anon, authenticated;
grant all on table public.embryo_operation_nonces to service_role;

-- ---------------------------------------------------------------------------
-- 3. Private helpers
-- ---------------------------------------------------------------------------

create or replace function private.consume_embryo_operation_nonce_v1(
  p_nonce text,
  p_account_id uuid,
  p_session_id uuid,
  p_operation text,
  p_target_kind text,
  p_target_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_nonce is null
    or p_nonce !~ '^[A-Za-z0-9_-]+$'
    or length(p_nonce) < 16 or length(p_nonce) > 256
  then
    raise exception using errcode = '22023', message = 'invalid operation nonce';
  end if;
  begin
    insert into public.embryo_operation_nonces (
      nonce_hash, account_id, session_id, operation, target_kind, target_id
    ) values (
      encode(extensions.digest(convert_to(p_nonce, 'UTF8'), 'sha256'), 'hex'),
      p_account_id, p_session_id, p_operation, p_target_kind, p_target_id
    );
  exception when unique_violation then
    raise exception using errcode = '23505', message = 'operation nonce already used';
  end;
end;
$$;

revoke all on function private.consume_embryo_operation_nonce_v1(text, uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function private.consume_embryo_operation_nonce_v1(text, uuid, uuid, text, text, uuid)
  to service_role;

-- A Record Key: 20 characters over the Crockford base32 alphabet, 100 bits
-- drawn from 13 random bytes. Only its SHA-256 is ever stored.
create or replace function private.embryo_record_key_v1()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(13);
  v_bits bigint := 0;
  v_bit_count integer := 0;
  v_out text := '';
  v_i integer;
  v_index integer;
begin
  for v_i in 0..12 loop
    v_bits := (v_bits << 8) | get_byte(v_bytes, v_i);
    v_bit_count := v_bit_count + 8;
    while v_bit_count >= 5 and length(v_out) < 20 loop
      v_index := ((v_bits >> (v_bit_count - 5)) & 31)::integer;
      v_out := v_out || substr(v_alphabet, v_index + 1, 1);
      v_bit_count := v_bit_count - 5;
    end loop;
    v_bits := v_bits & ((1::bigint << v_bit_count) - 1);
  end loop;
  return v_out;
end;
$$;

revoke all on function private.embryo_record_key_v1() from public, anon, authenticated;
grant execute on function private.embryo_record_key_v1() to service_role;

-- The statement keys each artifact publishes, mirrored by
-- src/lib/embryos/basis.ts. The marker comments are parsed by
-- content/legal/legal-content.test.ts, which asserts SQL and TypeScript
-- agree, so keep each array on the lines after its marker.
create or replace function private.embryo_statement_keys_v1(
  p_artifact_key text,
  p_form text default null
)
returns text[]
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  case
    when p_artifact_key = 'consent.upload-embryo' and p_form = 'uploader' then
      -- statement-keys:consent.upload-embryo:uploader
      return array['uploader-right-to-files', 'not-a-genetic-parent',
        'parents-permission-held', 'withdraw-any-time'];
    when p_artifact_key = 'consent.upload-embryo' and p_form = 'grant' then
      -- statement-keys:consent.upload-embryo:grant
      return array['one-purpose', 'every-parent-must-agree',
        'pause-or-stop-any-time'];
    when p_artifact_key = 'consent.upload-embryo' then
      -- statement-keys:consent.upload-embryo:parent
      return array['genetic-parent-or-authority', 'no-outcome-data',
        'future-person-charter', 'withdraw-any-time'];
    when p_artifact_key = 'attestation.embryo-parentage' then
      -- statement-keys:attestation.embryo-parentage
      return array['genetic-parent-of-these-embryos',
        'other-parent-named-truthfully', 'false-statement-warning-read'];
    when p_artifact_key = 'attestation.embryo-disposition-rights' then
      -- statement-keys:attestation.embryo-disposition-rights
      return array['right-to-decide-disposition', 'no-dispute-or-proceeding',
        'objection-stops-and-deletes'];
    when p_artifact_key = 'attestation.embryo-single-parent-basis' then
      -- statement-keys:attestation.embryo-single-parent-basis
      return array['basis-is-true', 'evidence-is-genuine',
        'objection-stops-analysis'];
    when p_artifact_key = 'charter.future-person' then
      -- statement-keys:charter.future-person
      return array['read-in-full', 'rights-are-enforceable'];
    when p_artifact_key = 'disclosure.insurance-and-discrimination' then
      -- statement-keys:disclosure.insurance-and-discrimination
      return array['understood'];
    else
      return null;
  end case;
end;
$$;

revoke all on function private.embryo_statement_keys_v1(text, text) from public, anon, authenticated;
grant execute on function private.embryo_statement_keys_v1(text, text) to service_role;

-- The current version of an artifact, or 55000 when the requested version is
-- not the current one (a superseded artifact cannot be signed).
create or replace function private.current_embryo_artifact_v1(
  p_artifact_key text,
  p_version integer
)
returns public.consent_artifacts
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_artifact public.consent_artifacts%rowtype;
begin
  select a.* into v_artifact
  from public.consent_artifacts a
  where a.artifact_key = p_artifact_key
    and a.superseded_at is null
  order by a.version desc
  limit 1;
  if v_artifact.artifact_key is null then
    raise exception using errcode = '42501', message = 'artifact unavailable';
  end if;
  if p_version is not null and v_artifact.version <> p_version then
    raise exception using errcode = '55000', message = 'artifact superseded';
  end if;
  return v_artifact;
end;
$$;

revoke all on function private.current_embryo_artifact_v1(text, integer) from public, anon, authenticated;
grant execute on function private.current_embryo_artifact_v1(text, integer) to service_role;

-- policyResolvers.embryo-basis-authority-v1: the one server-side authority
-- for a draft's basis class and its five principal sets. The sets are
-- derived only from current parent slots whose principal is active; a
-- non-parent uploader, owner, reviewer or donor is never a member.
create or replace function private.resolve_embryo_basis_authority_v1(
  p_draft_id uuid
)
returns table (
  basis_case text,
  disposition_mode text,
  required_upload_principals uuid[],
  disposition_authorities uuid[],
  attribution_principals uuid[],
  notice_recipients uuid[],
  record_key_recipients uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_basis text;
  v_parents uuid[];
begin
  select d.basis_case into v_basis
  from public.embryo_cohort_drafts d
  where d.id = p_draft_id;
  if v_basis is null then
    raise exception using errcode = '42501', message = 'draft unavailable';
  end if;

  select coalesce(array_agg(s.principal_id order by s.slot_kind), '{}'::uuid[])
  into v_parents
  from public.draft_participant_slots s
  join public.subject_principals sp on sp.id = s.principal_id
  where s.embryo_draft_id = p_draft_id
    and s.slot_kind in ('parent_a', 'parent_b')
    and s.state = 'current'
    and sp.principal_kind = 'genetic_parent'
    and sp.status = 'active';

  if (v_basis = 'true_two_parent' and cardinality(v_parents) <> 2)
    or (v_basis <> 'true_two_parent' and cardinality(v_parents) <> 1)
  then
    raise exception using errcode = '55000', message = 'basis unresolved';
  end if;

  return query select
    v_basis,
    case when v_basis = 'true_two_parent'
      then 'two-parent-propose-confirm' else 'single-authority-direct' end,
    v_parents, v_parents, '{}'::uuid[], v_parents, v_parents;
end;
$$;

revoke all on function private.resolve_embryo_basis_authority_v1(uuid) from public, anon, authenticated;
grant execute on function private.resolve_embryo_basis_authority_v1(uuid) to service_role;

-- The current members of one persisted cohort set.
create or replace function private.embryo_cohort_set_v1(
  p_cohort_id uuid,
  p_set_kind text
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(ps.principal_id order by ps.created_at, ps.principal_id), '{}'::uuid[])
  from public.embryo_participant_sets ps
  join public.embryo_cohorts c on c.id = ps.cohort_id
  where ps.cohort_id = p_cohort_id
    and ps.set_kind = p_set_kind
    and ps.revoked_at is null
    and ps.set_revision = c.participant_set_revision;
$$;

revoke all on function private.embryo_cohort_set_v1(uuid, text) from public, anon, authenticated;
grant execute on function private.embryo_cohort_set_v1(uuid, text) to service_role;

-- The one member of a set the acting account controls, or null.
create or replace function private.acting_embryo_principal_v1(
  p_account_id uuid,
  p_principal_ids uuid[]
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sp.id
  from public.subject_principals sp
  where sp.id = any (p_principal_ids)
    and sp.account_id = p_account_id
    and sp.status = 'active'
  order by sp.created_at
  limit 1;
$$;

revoke all on function private.acting_embryo_principal_v1(uuid, uuid[]) from public, anon, authenticated;
grant execute on function private.acting_embryo_principal_v1(uuid, uuid[]) to service_role;

-- Queue one mail to a principal through its current envelope-encrypted
-- contact reference. Returns null (and writes nothing) when the principal has
-- no current contact; returns the existing outbox id on a repeated
-- idempotency key.
create or replace function private.enqueue_embryo_principal_mail_v1(
  p_principal_id uuid,
  p_template_id text,
  p_purpose text,
  p_target_kind text,
  p_target_id uuid,
  p_payload jsonb,
  p_idempotency_key text,
  p_expires_at timestamptz,
  p_token_purpose text,
  p_token_target_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_principal public.subject_principals%rowtype;
  v_contact public.encrypted_contact_references%rowtype;
  v_outbox_id uuid;
begin
  select m.id into v_outbox_id
  from public.mail_outbox m
  where m.idempotency_key = p_idempotency_key;
  if v_outbox_id is not null then
    return v_outbox_id;
  end if;

  select sp.* into v_principal
  from public.subject_principals sp
  where sp.id = p_principal_id
  for update;
  if v_principal.id is null or v_principal.status not in ('active', 'pending') then
    return null;
  end if;

  select ecr.* into v_contact
  from public.encrypted_contact_references ecr
  where ecr.principal_id = p_principal_id
    and ecr.status = 'current'
    and ecr.contact_ciphertext is not null
  order by ecr.created_at desc
  limit 1
  for update;
  if v_contact.id is null then
    return null;
  end if;

  -- The mail worker delivers only while the contact's authority revision
  -- equals the principal's; keep them aligned.
  if v_contact.authority_revision <> v_principal.principal_revision then
    update public.encrypted_contact_references
    set authority_revision = v_principal.principal_revision
    where id = v_contact.id;
  end if;

  insert into public.mail_outbox (
    template_id, purpose, target_kind, target_id,
    recipient_principal_id, contact_reference_id,
    recipient_authority_revision, semantic_revision, idempotency_key,
    token_purpose, token_target_id, template_payload, expires_at
  ) values (
    p_template_id, p_purpose, p_target_kind, p_target_id,
    p_principal_id, v_contact.id,
    v_principal.principal_revision, 1, p_idempotency_key,
    p_token_purpose, p_token_target_id, coalesce(p_payload, '{}'::jsonb),
    p_expires_at
  ) returning id into v_outbox_id;

  if p_token_purpose is not null then
    insert into public.token_candidates (
      outbox_id, purpose, target_kind, target_id, token_revision, state,
      expires_at
    ) values (
      v_outbox_id, p_token_purpose, p_target_kind, p_token_target_id, 1,
      'pending', p_expires_at
    );
  end if;

  return v_outbox_id;
end;
$$;

revoke all on function private.enqueue_embryo_principal_mail_v1(
  uuid, text, text, text, uuid, jsonb, text, timestamptz, text, uuid
) from public, anon, authenticated;
grant execute on function private.enqueue_embryo_principal_mail_v1(
  uuid, text, text, text, uuid, jsonb, text, timestamptz, text, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Route-callable RPCs
-- ---------------------------------------------------------------------------

-- api.embryo-cohort-drafts: reserve a no-data, no-analysis cohort draft with
-- its parent slots, typed contacts and the fixed 30-day deadline, or write
-- nothing. Contacts arrive already envelope-encrypted and HMACed; the
-- plaintext never reaches the database.
create or replace function public.create_embryo_cohort_draft_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_upload_situation text,
  p_basis_case text,
  p_embryo_count integer,
  p_owner_contact_ciphertext bytea,
  p_owner_contact_hmac text,
  p_contact_ciphertexts text[],
  p_contact_hmacs text[],
  p_token_nonce text,
  p_test_jurisdiction boolean
)
returns table (
  draft_id uuid,
  expires_at timestamptz,
  required_principal_slots text[]
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_deadline timestamptz := clock_timestamp() + interval '30 days';
  v_uploader public.subject_principals%rowtype;
  v_expected_contacts integer;
  v_upload_class text;
  v_state text;
  v_draft_id uuid;
  v_retention_id uuid;
  v_slot_kinds text[];
  v_slot_labels text[];
  v_i integer;
  v_principal_id uuid;
  v_contact_id uuid;
  v_slot_offset integer := 0;
begin
  if not p_test_jurisdiction then
    raise exception using errcode = '42501', message = 'embryo analysis unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'cohort_draft_create',
    'account', p_account_id
  );

  if p_upload_situation not in ('own_embryos', 'with_genetic_parents_permission')
    or p_basis_case not in (
      'true_two_parent', 'anonymous_donor', 'parent_deceased', 'sole_legal_authority'
    )
    or p_embryo_count is null or p_embryo_count < 1 or p_embryo_count > 64
    or p_owner_contact_ciphertext is null
    or p_owner_contact_hmac !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'invalid draft request';
  end if;

  v_expected_contacts := case
    when p_upload_situation = 'own_embryos' and p_basis_case = 'true_two_parent' then 1
    when p_upload_situation = 'own_embryos' then 0
    when p_basis_case = 'true_two_parent' then 2
    else 1
  end;
  if coalesce(cardinality(p_contact_hmacs), 0) <> v_expected_contacts
    or coalesce(cardinality(p_contact_ciphertexts), 0) <> v_expected_contacts
  then
    raise exception using errcode = '22023', message = 'invalid contact cardinality';
  end if;
  for v_i in 1..v_expected_contacts loop
    if p_contact_hmacs[v_i] is null
      or p_contact_hmacs[v_i] !~ '^[0-9a-f]{64}$'
      or p_contact_ciphertexts[v_i] is null
      or p_contact_ciphertexts[v_i] !~ '^([0-9a-f]{2}){16,}$'
      or p_contact_hmacs[v_i] = p_owner_contact_hmac
      or (v_i = 2 and p_contact_hmacs[1] = p_contact_hmacs[2])
    then
      raise exception using errcode = '22023', message = 'invalid contact';
    end if;
  end loop;

  select sp.* into v_uploader
  from public.subject_principals sp
  join public.subjects s on s.id = sp.subject_id
  where sp.account_id = p_account_id
    and sp.principal_kind = 'account_subject'
    and sp.status = 'active'
    and s.subject_class = 'self'
    and s.subject_account_id = p_account_id
    and s.lifecycle = 'active'
  order by sp.created_at
  limit 1
  for update of sp, s;
  if v_uploader.id is null then
    raise exception using errcode = '42501', message = 'account is not eligible';
  end if;
  if exists (
    select 1 from public.account_deletion_requests adr
    where adr.account_id = p_account_id
      and adr.state in ('notice_period', 'delete_started')
  ) then
    raise exception using errcode = '42501', message = 'account is not eligible';
  end if;

  v_upload_class := case when p_upload_situation = 'own_embryos'
    then 'embryo_own' else 'embryo_third_party' end;
  v_state := case when p_basis_case in ('parent_deceased', 'sole_legal_authority')
    then 'evidence_pending' else 'draft' end;

  insert into public.embryo_cohort_drafts (
    owner_account_id, uploader_principal_id, upload_class, basis_case,
    embryo_count, state, fixed_expires_at, upload_situation
  ) values (
    p_account_id, v_uploader.id, v_upload_class, p_basis_case,
    p_embryo_count, v_state, v_deadline, p_upload_situation
  ) returning id into v_draft_id;

  -- Slot layout: own embryos put the uploader in parent_a; a third-party
  -- upload fills parent_a (and parent_b) from the typed contacts.
  if p_upload_situation = 'own_embryos' then
    insert into public.subject_principals (
      account_id, principal_kind, principal_revision, status
    ) values (p_account_id, 'genetic_parent', 1, 'active')
    returning id into v_principal_id;
    insert into public.encrypted_contact_references (
      principal_id, contact_ciphertext, contact_hmac, key_revision,
      authority_revision, status
    ) values (
      v_principal_id, p_owner_contact_ciphertext, p_owner_contact_hmac, 1, 1,
      'current'
    ) returning id into v_contact_id;
    insert into public.contact_hmac_indexes (
      contact_reference_id, contact_hmac, hmac_key_revision, status, expires_at
    ) values (v_contact_id, p_owner_contact_hmac, 1, 'current', v_deadline);
    insert into public.draft_participant_slots (
      embryo_draft_id, slot_kind, principal_id, slot_revision, state
    ) values (v_draft_id, 'parent_a', v_principal_id, 1, 'current');
    v_slot_offset := 1;
    v_slot_labels := case when p_basis_case = 'true_two_parent'
      then array['other-genetic-parent'] else '{}'::text[] end;
  else
    v_slot_labels := case when p_basis_case = 'true_two_parent'
      then array['genetic-parent', 'genetic-parent'] else array['genetic-parent'] end;
  end if;

  v_slot_kinds := array['parent_a', 'parent_b'];
  for v_i in 1..v_expected_contacts loop
    insert into public.subject_principals (
      principal_kind, principal_revision, status
    ) values ('genetic_parent', 1, 'pending')
    returning id into v_principal_id;
    insert into public.encrypted_contact_references (
      principal_id, contact_ciphertext, contact_hmac, key_revision,
      authority_revision, status
    ) values (
      v_principal_id, decode(p_contact_ciphertexts[v_i], 'hex'),
      p_contact_hmacs[v_i], 1, 1, 'current'
    ) returning id into v_contact_id;
    insert into public.contact_hmac_indexes (
      contact_reference_id, contact_hmac, hmac_key_revision, status, expires_at
    ) values (v_contact_id, p_contact_hmacs[v_i], 1, 'current', v_deadline);
    insert into public.draft_participant_slots (
      embryo_draft_id, slot_kind, principal_id, slot_revision, state
    ) values (
      v_draft_id, v_slot_kinds[v_slot_offset + v_i], v_principal_id, 1, 'pending'
    );
  end loop;

  insert into public.retention_rows (
    retention_id, target_kind, target_id, retention_revision,
    target_lifecycle_revision, disposition_revision, fixed_deadline, state
  ) values (
    'embryo.cohort-draft-30d', 'cohort', v_draft_id, 1, 1, 1, v_deadline,
    'scheduled'
  ) returning id into v_retention_id;

  insert into public.retention_due_phases (
    retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
    phase_deadline, target_kind, target_id, target_lifecycle_revision,
    disposition_revision, recipient_authority_kind,
    recipient_authority_revision, immutable_envelope
  ) values (
    v_retention_id, 'embryo.cohort-draft-30d', 'embryo-cohort-draft-expiry',
    'compound-atomic', 1, v_deadline, 'cohort', v_draft_id, 1, 1,
    'account-subject-principal', v_uploader.principal_revision,
    jsonb_build_object('draftId', v_draft_id)
  );

  insert into public.purge_manifests (
    retention_row_id, phase_id, phase_revision, manifest_class,
    manifest_revision, source_binding_fingerprint, state
  ) values (
    v_retention_id, 'embryo-cohort-draft-expiry', 1, 'cohort-draft-complete', 1,
    encode(extensions.digest(convert_to(
      concat_ws(':', 'embryo-cohort-draft-v1', v_draft_id::text,
        p_account_id::text, v_deadline::text),
      'UTF8'), 'sha256'), 'hex'),
    'frozen'
  );

  perform private.append_legal_audit_event(
    'embryo.draft.created', null, 'api.embryo-cohort-drafts', 'accepted',
    jsonb_build_object(
      'basis_case', p_basis_case, 'upload_class', v_upload_class,
      'embryo_count', p_embryo_count
    )
  );

  return query select v_draft_id, v_deadline, v_slot_labels;
end;
$$;

revoke all on function public.create_embryo_cohort_draft_v1(
  uuid, uuid, text, text, integer, bytea, text, text[], text[], text, boolean
) from public, anon, authenticated;
grant execute on function public.create_embryo_cohort_draft_v1(
  uuid, uuid, text, text, integer, bytea, text, text[], text[], text, boolean
) to service_role;

-- api.consents sign-artifact with cohortDraftId: one Tier-2 signature by the
-- exact principal the artifact belongs to. The signer is derived from the
-- draft's slots and the acting account, never from the request.
create or replace function public.sign_embryo_artifact_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_artifact_key text,
  p_artifact_version integer,
  p_statement_keys text[],
  p_signing_name_ciphertext bytea,
  p_jurisdiction_code text,
  p_token_nonce text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_draft public.embryo_cohort_drafts%rowtype;
  v_artifact public.consent_artifacts%rowtype;
  v_profile public.profiles%rowtype;
  v_actor_parent uuid;
  v_signer uuid;
  v_keys text[];
  v_purpose text;
  v_kind text;
  v_role text;
  v_signature_id uuid;
begin
  if p_target_kind <> 'cohort_draft' then
    raise exception using errcode = '42501', message = 'target unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'artifact_sign',
    'cohort_draft', p_target_id
  );

  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = p_target_id
  for update;
  if v_draft.id is null
    or v_draft.state not in ('draft', 'evidence_pending', 'ready')
    or v_draft.fixed_expires_at <= v_now
  then
    raise exception using errcode = '42501', message = 'draft unavailable';
  end if;

  if p_signing_name_ciphertext is null
    or p_jurisdiction_code !~ '^[A-Z]{2}$'
    or p_statement_keys is null
  then
    raise exception using errcode = '22023', message = 'invalid signature request';
  end if;

  select sp.id into v_actor_parent
  from public.draft_participant_slots s
  join public.subject_principals sp on sp.id = s.principal_id
  where s.embryo_draft_id = v_draft.id
    and s.slot_kind in ('parent_a', 'parent_b')
    and s.state = 'current'
    and sp.account_id = p_account_id
    and sp.status = 'active'
  order by s.slot_kind
  limit 1;

  case p_artifact_key
    when 'consent.upload-embryo' then
      if v_draft.owner_account_id <> p_account_id then
        raise exception using errcode = '42501', message = 'not the draft owner';
      end if;
      if v_draft.upload_situation = 'own_embryos' then
        v_signer := v_actor_parent;
        v_keys := private.embryo_statement_keys_v1('consent.upload-embryo', 'parent');
        v_purpose := 'embryo-upload-parent-class';
        v_role := 'parent';
      else
        v_signer := v_draft.uploader_principal_id;
        v_keys := private.embryo_statement_keys_v1('consent.upload-embryo', 'uploader');
        v_purpose := 'embryo-upload-uploader-class';
        v_role := 'uploader';
      end if;
    when 'attestation.embryo-parentage' then
      v_signer := v_actor_parent;
      v_keys := private.embryo_statement_keys_v1(p_artifact_key);
      v_purpose := 'embryo-parentage-attestation';
      v_kind := 'genetic_parent';
      v_role := 'parent';
    when 'attestation.embryo-disposition-rights' then
      v_signer := v_actor_parent;
      v_keys := private.embryo_statement_keys_v1(p_artifact_key);
      v_purpose := 'embryo-disposition-rights-attestation';
      v_kind := 'disposition_rights';
      v_role := 'parent';
    when 'attestation.embryo-single-parent-basis' then
      if v_draft.basis_case = 'true_two_parent' then
        raise exception using errcode = '22023', message = 'basis does not take this artifact';
      end if;
      v_signer := v_actor_parent;
      v_keys := private.embryo_statement_keys_v1(p_artifact_key);
      v_purpose := 'embryo-single-parent-basis-attestation';
      v_kind := 'single_parent_authority';
      v_role := 'parent';
    when 'charter.future-person' then
      if v_draft.owner_account_id <> p_account_id then
        raise exception using errcode = '42501', message = 'not the draft owner';
      end if;
      v_signer := v_draft.uploader_principal_id;
      v_keys := private.embryo_statement_keys_v1(p_artifact_key);
      v_purpose := 'future-person-charter-acknowledgement';
      v_kind := 'future_person_acknowledgement';
      v_role := 'owner';
    when 'disclosure.insurance-and-discrimination' then
      if v_draft.owner_account_id <> p_account_id then
        raise exception using errcode = '42501', message = 'not the draft owner';
      end if;
      v_signer := v_draft.uploader_principal_id;
      v_keys := private.embryo_statement_keys_v1(p_artifact_key);
      v_purpose := 'disclosure-acknowledgement';
      v_role := 'owner';
    else
      raise exception using errcode = '42501', message = 'artifact unavailable';
  end case;

  if v_signer is null then
    raise exception using errcode = '42501', message = 'not a current parent';
  end if;
  if p_statement_keys <> v_keys then
    raise exception using errcode = '22023', message = 'statement keys differ from the published set';
  end if;

  v_artifact := private.current_embryo_artifact_v1(p_artifact_key, p_artifact_version);

  select cs.id into v_signature_id
  from public.consent_signatures cs
  where cs.signer_principal_id = v_signer
    and cs.artifact_key = v_artifact.artifact_key
    and cs.artifact_version = v_artifact.version
    and cs.target_kind = 'cohort_draft'
    and cs.target_id = v_draft.id
    and cs.purpose = v_purpose
  order by cs.signed_at desc
  limit 1;
  if v_signature_id is not null then
    return v_signature_id;
  end if;

  select * into v_profile from public.profiles where id = p_account_id;

  insert into public.consent_signatures (
    artifact_key, artifact_version, artifact_body_sha256,
    signer_principal_id, signer_account_id, target_kind, target_id,
    purpose, statement_keys, signing_name_encrypted,
    jurisdiction_code, jurisdiction_revision
  ) values (
    v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
    v_signer, p_account_id, 'cohort_draft', v_draft.id,
    v_purpose, v_keys, p_signing_name_ciphertext,
    p_jurisdiction_code, coalesce(v_profile.jurisdiction_revision, 1)
  ) returning id into v_signature_id;

  if v_kind is not null then
    insert into public.attestations (
      signature_id, principal_id, target_kind, target_id, kind,
      statement_keys, affirmed
    ) values (
      v_signature_id, v_signer, 'cohort_draft', v_draft.id, v_kind,
      v_keys, true
    );
  end if;

  perform private.append_legal_audit_event(
    'embryo.artifact.signed', null, 'api.consents', 'accepted',
    jsonb_build_object(
      'artifact_key', v_artifact.artifact_key, 'version', v_artifact.version,
      'role', v_role
    )
  );

  return v_signature_id;
end;
$$;

revoke all on function public.sign_embryo_artifact_v1(
  uuid, uuid, text, uuid, text, integer, text[], bytea, text, text
) from public, anon, authenticated;
grant execute on function public.sign_embryo_artifact_v1(
  uuid, uuid, text, uuid, text, integer, text[], bytea, text, text
) to service_role;

-- api.invitations with targetCohortDraftId: mail the one unfilled parent slot
-- whose typed contact matches. A mismatch, a filled slot or a live refusal
-- bar returns the same empty receipt with no write, so the response never
-- reveals which addresses the draft names.
create or replace function public.create_embryo_draft_invitation_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_draft_id uuid,
  p_contact_hmac text,
  p_idempotency_key text,
  p_token_nonce text,
  p_test_jurisdiction boolean
)
returns table (
  invitation_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_draft public.embryo_cohort_drafts%rowtype;
  v_slot public.draft_participant_slots%rowtype;
  v_contact public.encrypted_contact_references%rowtype;
  v_invitation_id uuid;
  v_outbox_id uuid;
  v_placeholder_hash text;
begin
  if not p_test_jurisdiction
    or p_contact_hmac !~ '^[0-9a-f]{64}$'
    or p_idempotency_key !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '42501', message = 'invitation unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'invitation_create',
    'cohort_draft', p_draft_id
  );

  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = p_draft_id
  for update;
  if v_draft.id is null
    or v_draft.owner_account_id <> p_account_id
    or v_draft.state not in ('draft', 'evidence_pending', 'ready')
    or v_draft.fixed_expires_at <= v_now
  then
    raise exception using errcode = '42501', message = 'draft unavailable';
  end if;

  -- The uploader's own class artifact comes first (uploaderArtifactPrecondition).
  if not exists (
    select 1
    from public.consent_signatures cs
    where cs.signer_account_id = p_account_id
      and cs.artifact_key = 'consent.upload-embryo'
      and cs.target_kind = 'cohort_draft'
      and cs.target_id = v_draft.id
  ) then
    raise exception using errcode = '42501', message = 'uploader artifact missing';
  end if;

  select m.target_id into v_invitation_id
  from public.mail_outbox m
  where m.idempotency_key = p_idempotency_key
    and m.template_id = 'co-parent-invitation';
  if v_invitation_id is not null then
    return query select v_invitation_id, v_draft.fixed_expires_at;
    return;
  end if;

  if exists (
    select 1 from public.contact_refusal_bars b
    where b.contact_hmac = p_contact_hmac and b.expires_at > v_now
  ) or exists (
    select 1 from public.invitation_refusal_hmacs b
    where b.email_hmac = p_contact_hmac and b.expires_at > v_now
  ) then
    return query select null::uuid, v_draft.fixed_expires_at;
    return;
  end if;

  select s.* into v_slot
  from public.draft_participant_slots s
  join public.subject_principals sp on sp.id = s.principal_id
  join public.encrypted_contact_references ecr
    on ecr.principal_id = sp.id and ecr.status = 'current'
  where s.embryo_draft_id = v_draft.id
    and s.slot_kind in ('parent_a', 'parent_b')
    and s.state = 'pending'
    and sp.status = 'pending'
    and ecr.contact_hmac = p_contact_hmac
    and not exists (
      select 1 from public.subject_invitations si
      where si.invitee_principal_id = sp.id
        and si.status in ('pending', 'accepted')
    )
  order by s.slot_kind
  limit 1
  for update of s;
  if v_slot.id is null then
    return query select null::uuid, v_draft.fixed_expires_at;
    return;
  end if;

  select ecr.* into v_contact
  from public.encrypted_contact_references ecr
  where ecr.principal_id = v_slot.principal_id and ecr.status = 'current'
  order by ecr.created_at desc
  limit 1;

  v_placeholder_hash := encode(extensions.digest(
    extensions.gen_random_bytes(32), 'sha256'
  ), 'hex');

  insert into public.subject_invitations (
    target_kind, target_id, inviter_principal_id, invitee_principal_id,
    email_hmac, email_encrypted, token_hash, invitation_kind, status,
    invitation_revision, expires_at
  ) values (
    'cohort_draft', v_draft.id, v_draft.uploader_principal_id, v_slot.principal_id,
    p_contact_hmac, v_contact.contact_ciphertext, v_placeholder_hash,
    'co_parent', 'pending', 1, v_draft.fixed_expires_at
  ) returning id into v_invitation_id;

  v_outbox_id := private.enqueue_embryo_principal_mail_v1(
    v_slot.principal_id, 'co-parent-invitation', 'co-parent-invitation',
    'subject_invitation', v_invitation_id, '{}'::jsonb, p_idempotency_key,
    v_draft.fixed_expires_at, 'co-parent-invitation', v_invitation_id
  );
  if v_outbox_id is null then
    raise exception using errcode = '55000', message = 'contact unavailable';
  end if;

  insert into public.invitation_candidates (
    invitation_id, draft_slot_id, contact_reference_id,
    candidate_revision, state
  ) values (v_invitation_id, v_slot.id, v_contact.id, 1, 'issued');

  perform private.append_legal_audit_event(
    'invitation.issued', null, 'api.invitations', 'accepted',
    jsonb_build_object('invitation_kind', 'co_parent', 'revision', 1)
  );

  return query select v_invitation_id, v_draft.fixed_expires_at;
end;
$$;

revoke all on function public.create_embryo_draft_invitation_v1(
  uuid, uuid, uuid, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.create_embryo_draft_invitation_v1(
  uuid, uuid, uuid, text, text, text, boolean
) to service_role;

-- The mail worker's claim now mints a delivery token for both invitation
-- purposes. Everything else in this function is unchanged from
-- 20260901040000_adult_subject_invitation_runtime.sql.
drop function public.claim_mail_outbox();

create function public.claim_mail_outbox()
returns table (
  outbox_id uuid,
  template_id text,
  template_payload jsonb,
  idempotency_key text,
  attempt_ordinal smallint,
  contact_ciphertext bytea,
  delivery_token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outbox public.mail_outbox%rowtype;
  v_candidate public.token_candidates%rowtype;
  v_raw_token text;
  v_token_hash text;
begin
  update public.mail_outbox m
  set state = 'expired', claimed_at = null, last_outcome_code = 'expired'
  where m.state in ('queued', 'claimed')
    and m.expires_at <= clock_timestamp();

  update public.mail_outbox m
  set state = 'invalidated', claimed_at = null,
      last_outcome_code = 'recipient_authority_stale'
  where m.state in ('queued', 'claimed')
    and not exists (
      select 1
      from public.subject_principals sp
      join public.encrypted_contact_references ecr
        on ecr.id = m.contact_reference_id
       and ecr.principal_id = sp.id
      where sp.id = m.recipient_principal_id
        and (
          sp.status = 'active'
          or (
            m.purpose in ('adult-subject-invitation', 'co-parent-invitation')
            and sp.status = 'pending'
          )
        )
        and sp.principal_revision = m.recipient_authority_revision
        and ecr.status = 'current'
        and ecr.authority_revision = m.recipient_authority_revision
        and ecr.contact_ciphertext is not null
    );

  select m.* into v_outbox
  from public.mail_outbox m
  where (
      (m.state = 'queued' and m.not_before <= clock_timestamp())
      or (
        m.state = 'claimed'
        and m.claimed_at < clock_timestamp() - interval '10 minutes'
      )
    )
    and m.expires_at > clock_timestamp()
    and m.attempt_count < 10
  order by m.not_before, m.created_at
  for update skip locked
  limit 1;

  if v_outbox.id is null then return; end if;

  update public.mail_outbox m
  set state = 'claimed',
      claimed_at = clock_timestamp(),
      attempt_count = (m.attempt_count + 1)::smallint,
      last_outcome_code = null
  where m.id = v_outbox.id
  returning m.* into v_outbox;

  if v_outbox.token_purpose in ('adult-subject-invitation', 'co-parent-invitation') then
    select tc.* into strict v_candidate
    from public.token_candidates tc
    where tc.outbox_id = v_outbox.id
      and tc.target_kind = 'subject_invitation'
      and tc.target_id = v_outbox.target_id
      and tc.expires_at > clock_timestamp()
    for update;

    v_raw_token := rtrim(translate(
      encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'
    ), '=');
    v_token_hash := encode(extensions.digest(
      convert_to(v_raw_token, 'UTF8'), 'sha256'
    ), 'hex');

    update public.token_hashes
    set status = 'revoked', ended_at = clock_timestamp()
    where candidate_id = v_candidate.id and status = 'current';

    insert into public.token_hashes (
      candidate_id, token_hash, token_revision, status
    ) values (
      v_candidate.id, v_token_hash, v_candidate.token_revision, 'current'
    );

    update public.token_candidates
    set state = 'issued'
    where id = v_candidate.id;

    update public.subject_invitations
    set token_hash = v_token_hash
    where id = v_candidate.target_id
      and status = 'pending'
      and expires_at > clock_timestamp();
    if not found then
      raise exception using errcode = '55000', message = 'invitation is not current';
    end if;
  end if;

  return query
  select
    v_outbox.id,
    v_outbox.template_id,
    v_outbox.template_payload,
    v_outbox.idempotency_key,
    v_outbox.attempt_count,
    ecr.contact_ciphertext,
    v_raw_token
  from public.encrypted_contact_references ecr
  where ecr.id = v_outbox.contact_reference_id;
end;
$$;

revoke all on function public.claim_mail_outbox()
  from public, anon, authenticated;
grant execute on function public.claim_mail_outbox() to service_role;

-- api.rights-activate: exchange a co-parent invitation token for one
-- hash-only, purpose-bound rights session. Anything invalid returns no row.
create or replace function public.activate_rights_session_v1(
  p_token_hash text,
  p_session_hash text
)
returns table (
  purpose text,
  target_kind text,
  target_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_token public.token_hashes%rowtype;
  v_candidate public.token_candidates%rowtype;
  v_invitation public.subject_invitations%rowtype;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_expires_at timestamptz;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_session_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select th.* into v_token
  from public.token_hashes th
  where th.token_hash = p_token_hash and th.status = 'current'
  for update;
  if v_token.id is null then return; end if;

  select tc.* into v_candidate
  from public.token_candidates tc
  where tc.id = v_token.candidate_id
    and tc.purpose = 'co-parent-invitation'
    and tc.state = 'issued'
    and tc.expires_at > v_now
  for update;
  if v_candidate.id is null then return; end if;

  select si.* into v_invitation
  from public.subject_invitations si
  where si.id = v_candidate.target_id
    and si.invitation_kind = 'co_parent'
    and si.status = 'pending'
    and si.expires_at > v_now
  for update;
  if v_invitation.id is null then return; end if;

  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = v_invitation.target_id
    and d.state in ('draft', 'evidence_pending', 'ready')
    and d.fixed_expires_at > v_now
  for update;
  if v_draft.id is null then return; end if;

  v_expires_at := least(v_now + interval '24 hours', v_invitation.expires_at);

  insert into public.rights_sessions (
    token_hash_id, principal_id, purpose, target_kind, target_id,
    authority_revision, session_hash, status, expires_at
  ) values (
    v_token.id, v_invitation.invitee_principal_id, 'co-parent-invitation',
    'cohort_draft', v_draft.id, v_invitation.invitation_revision,
    p_session_hash, 'active', v_expires_at
  );

  update public.token_hashes
  set status = 'consumed', ended_at = v_now
  where id = v_token.id;

  perform private.append_legal_audit_event(
    'rights.session.activated', null, 'api.rights-activate', 'accepted',
    jsonb_build_object('purpose', 'co-parent-invitation')
  );

  return query select
    'co-parent-invitation'::text, 'cohort_draft'::text, v_draft.id, v_expires_at;
end;
$$;

revoke all on function public.activate_rights_session_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.activate_rights_session_v1(text, text)
  to service_role;

-- api.invitation-accept (co_parent): bind the accepting account to the exact
-- parent slot and record its two Tier-2 signatures. The account must control
-- the invited address; Inherit does not claim this verifies parentage.
create or replace function public.accept_embryo_co_parent_invitation_v1(
  p_session_hash text,
  p_account_id uuid,
  p_account_email_hmac text,
  p_signing_name_ciphertext bytea,
  p_jurisdiction_code text,
  p_upload_statement_keys text[],
  p_parentage_statement_keys text[],
  p_token_nonce text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_session public.rights_sessions%rowtype;
  v_invitation public.subject_invitations%rowtype;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_slot public.draft_participant_slots%rowtype;
  v_principal public.subject_principals%rowtype;
  v_profile public.profiles%rowtype;
  v_upload public.consent_artifacts%rowtype;
  v_parentage public.consent_artifacts%rowtype;
  v_signature_id uuid;
begin
  if p_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '42501', message = 'rights session unavailable';
  end if;

  select rs.* into v_session
  from public.rights_sessions rs
  where rs.session_hash = p_session_hash
    and rs.purpose = 'co-parent-invitation'
    and rs.status = 'active'
    and rs.expires_at > v_now
  for update;
  if v_session.id is null then
    raise exception using errcode = '42501', message = 'rights session unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, null, 'invitation_accept',
    'rights_session', v_session.id
  );

  select si.* into v_invitation
  from public.subject_invitations si
  where si.invitee_principal_id = v_session.principal_id
    and si.target_kind = 'cohort_draft'
    and si.target_id = v_session.target_id
    and si.invitation_kind = 'co_parent'
    and si.status = 'pending'
    and si.expires_at > v_now
  for update;
  if v_invitation.id is null then
    raise exception using errcode = '42501', message = 'invitation unavailable';
  end if;

  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = v_invitation.target_id
    and d.state in ('draft', 'evidence_pending', 'ready')
    and d.fixed_expires_at > v_now
  for update;
  if v_draft.id is null or v_draft.owner_account_id = p_account_id then
    raise exception using errcode = '42501', message = 'draft unavailable';
  end if;

  select s.* into v_slot
  from public.draft_participant_slots s
  where s.embryo_draft_id = v_draft.id
    and s.principal_id = v_session.principal_id
    and s.slot_kind in ('parent_a', 'parent_b')
    and s.state = 'pending'
  for update;
  if v_slot.id is null then
    raise exception using errcode = '42501', message = 'slot unavailable';
  end if;

  select sp.* into v_principal
  from public.subject_principals sp
  where sp.id = v_session.principal_id
    and sp.principal_kind = 'genetic_parent'
    and sp.status = 'pending'
  for update;
  if v_principal.id is null then
    raise exception using errcode = '42501', message = 'principal unavailable';
  end if;

  if p_account_email_hmac is null
    or p_account_email_hmac <> v_invitation.email_hmac
  then
    raise exception using errcode = '42501', message = 'address does not match';
  end if;

  if not exists (
    select 1
    from public.subject_principals sp
    join public.subjects s on s.id = sp.subject_id
    where sp.account_id = p_account_id
      and sp.principal_kind = 'account_subject'
      and sp.status = 'active'
      and s.subject_class = 'self'
      and s.lifecycle = 'active'
  ) or exists (
    select 1 from public.account_deletion_requests adr
    where adr.account_id = p_account_id
      and adr.state in ('notice_period', 'delete_started')
  ) then
    raise exception using errcode = '42501', message = 'account is not eligible';
  end if;

  if p_signing_name_ciphertext is null
    or p_jurisdiction_code !~ '^[A-Z]{2}$'
    or p_upload_statement_keys is distinct from
      private.embryo_statement_keys_v1('consent.upload-embryo', 'parent')
    or p_parentage_statement_keys is distinct from
      private.embryo_statement_keys_v1('attestation.embryo-parentage')
  then
    raise exception using errcode = '22023', message = 'invalid acceptance';
  end if;

  v_upload := private.current_embryo_artifact_v1('consent.upload-embryo', null);
  v_parentage := private.current_embryo_artifact_v1('attestation.embryo-parentage', null);
  select * into v_profile from public.profiles where id = p_account_id;

  update public.subject_principals
  set account_id = p_account_id,
      status = 'active',
      principal_revision = principal_revision + 1
  where id = v_principal.id
  returning * into v_principal;

  update public.encrypted_contact_references
  set authority_revision = v_principal.principal_revision
  where principal_id = v_principal.id and status = 'current';

  update public.draft_participant_slots
  set state = 'current', slot_revision = slot_revision + 1
  where id = v_slot.id;

  update public.subject_invitations
  set status = 'accepted', accepted_at = v_now, terminal_at = v_now,
      email_encrypted = null
  where id = v_invitation.id;

  update public.invitation_candidates
  set state = 'accepted'
  where invitation_id = v_invitation.id;

  update public.rights_sessions
  set status = 'consumed', ended_at = v_now
  where id = v_session.id;

  insert into public.consent_signatures (
    artifact_key, artifact_version, artifact_body_sha256,
    signer_principal_id, signer_account_id, target_kind, target_id,
    purpose, statement_keys, signing_name_encrypted,
    jurisdiction_code, jurisdiction_revision
  ) values (
    v_upload.artifact_key, v_upload.version, v_upload.body_sha256,
    v_principal.id, p_account_id, 'cohort_draft', v_draft.id,
    'embryo-upload-parent-class', p_upload_statement_keys,
    p_signing_name_ciphertext, p_jurisdiction_code,
    coalesce(v_profile.jurisdiction_revision, 1)
  );

  insert into public.consent_signatures (
    artifact_key, artifact_version, artifact_body_sha256,
    signer_principal_id, signer_account_id, target_kind, target_id,
    purpose, statement_keys, signing_name_encrypted,
    jurisdiction_code, jurisdiction_revision
  ) values (
    v_parentage.artifact_key, v_parentage.version, v_parentage.body_sha256,
    v_principal.id, p_account_id, 'cohort_draft', v_draft.id,
    'embryo-parentage-attestation', p_parentage_statement_keys,
    p_signing_name_ciphertext, p_jurisdiction_code,
    coalesce(v_profile.jurisdiction_revision, 1)
  ) returning id into v_signature_id;

  insert into public.attestations (
    signature_id, principal_id, target_kind, target_id, kind,
    statement_keys, affirmed
  ) values (
    v_signature_id, v_principal.id, 'cohort_draft', v_draft.id,
    'genetic_parent', p_parentage_statement_keys, true
  );

  perform private.append_legal_audit_event(
    'invitation.accepted', null, 'api.invitation-accept', 'accepted',
    jsonb_build_object('invitation_kind', 'co_parent')
  );

  return v_draft.id;
end;
$$;

revoke all on function public.accept_embryo_co_parent_invitation_v1(
  text, uuid, text, bytea, text, text[], text[], text
) from public, anon, authenticated;
grant execute on function public.accept_embryo_co_parent_invitation_v1(
  text, uuid, text, bytea, text, text[], text[], text
) to service_role;

-- api.embryo-cohorts: consume the draft into one cohort with the declared
-- count of embryo subjects, persist the five authority sets and the basis
-- binding, create one unconsumed print right per Record Key recipient per
-- embryo, and return raw keys only to the acting recipient, exactly once.
-- The ingest session is opened by the next slice; until then a finalized
-- cohort waits in upload_pending.
create or replace function public.finalize_embryo_cohort_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_draft_id uuid,
  p_insurance_ack_id uuid,
  p_charter_ack_id uuid,
  p_token_nonce text
)
returns table (
  cohort_id uuid,
  embryo_count integer,
  recipient_set_revision bigint,
  key_revision bigint,
  caller_state text,
  cards jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_draft public.embryo_cohort_drafts%rowtype;
  v_authority record;
  v_parent uuid;
  v_missing text[] := '{}'::text[];
  v_upload_version integer;
  v_parentage_version integer;
  v_rights_version integer;
  v_single_version integer;
  v_disclosure_version integer;
  v_charter_version integer;
  v_single_signature uuid;
  v_review_id uuid;
  v_evidence_id uuid;
  v_evidence_kind text;
  v_cohort_id uuid;
  v_retention_deadline timestamptz := clock_timestamp() + interval '24 months';
  v_ordinal integer;
  v_subject_id uuid;
  v_embryo_id uuid;
  v_recipient uuid;
  v_actor_principal uuid;
  v_record_key text;
  v_cards jsonb := '[]'::jsonb;
  v_signature_ids uuid[];
  v_fingerprint text;
  v_set_kind text;
begin
  select d.* into v_draft
  from public.embryo_cohort_drafts d
  where d.id = p_draft_id
  for update;
  if v_draft.id is null
    or v_draft.owner_account_id <> p_account_id
    or v_draft.state not in ('draft', 'evidence_pending', 'ready')
    or v_draft.fixed_expires_at <= v_now
  then
    raise exception using errcode = '42501', message = 'draft unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'cohort_finalize',
    'cohort_draft', v_draft.id
  );

  select * into v_authority
  from private.resolve_embryo_basis_authority_v1(v_draft.id);

  select a.version into v_upload_version from public.consent_artifacts a
    where a.artifact_key = 'consent.upload-embryo' and a.superseded_at is null;
  select a.version into v_parentage_version from public.consent_artifacts a
    where a.artifact_key = 'attestation.embryo-parentage' and a.superseded_at is null;
  select a.version into v_rights_version from public.consent_artifacts a
    where a.artifact_key = 'attestation.embryo-disposition-rights' and a.superseded_at is null;
  select a.version into v_single_version from public.consent_artifacts a
    where a.artifact_key = 'attestation.embryo-single-parent-basis' and a.superseded_at is null;
  select a.version into v_disclosure_version from public.consent_artifacts a
    where a.artifact_key = 'disclosure.insurance-and-discrimination' and a.superseded_at is null;
  select a.version into v_charter_version from public.consent_artifacts a
    where a.artifact_key = 'charter.future-person' and a.superseded_at is null;

  -- caseArtifactMatrix: the common artifacts for every required principal.
  foreach v_parent in array v_authority.required_upload_principals loop
    if not exists (
      select 1 from public.consent_signatures cs
      where cs.signer_principal_id = v_parent
        and cs.artifact_key = 'consent.upload-embryo'
        and cs.artifact_version = v_upload_version
        and cs.purpose = 'embryo-upload-parent-class'
        and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
    ) then
      v_missing := array_append(v_missing, 'upload-embryo');
    end if;
    if not exists (
      select 1 from public.consent_signatures cs
      where cs.signer_principal_id = v_parent
        and cs.artifact_key = 'attestation.embryo-parentage'
        and cs.artifact_version = v_parentage_version
        and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
    ) then
      v_missing := array_append(v_missing, 'parentage');
    end if;
    if not exists (
      select 1 from public.consent_signatures cs
      where cs.signer_principal_id = v_parent
        and cs.artifact_key = 'attestation.embryo-disposition-rights'
        and cs.artifact_version = v_rights_version
        and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
    ) then
      v_missing := array_append(v_missing, 'disposition-rights');
    end if;
  end loop;

  -- The basis-specific additional artifact and reviewed evidence.
  if v_authority.basis_case = 'true_two_parent' then
    if exists (
      select 1 from public.consent_signatures cs
      where cs.artifact_key = 'attestation.embryo-single-parent-basis'
        and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
    ) then
      raise exception using errcode = '55000', message = 'single-parent basis artifact present';
    end if;
  else
    select cs.id into v_single_signature
    from public.consent_signatures cs
    where cs.signer_principal_id = v_authority.required_upload_principals[1]
      and cs.artifact_key = 'attestation.embryo-single-parent-basis'
      and cs.artifact_version = v_single_version
      and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
    order by cs.signed_at desc
    limit 1;
    if v_single_signature is null then
      v_missing := array_append(v_missing, 'single-parent-basis');
    end if;
  end if;

  if v_authority.basis_case in ('parent_deceased', 'sole_legal_authority') then
    v_evidence_kind := case when v_authority.basis_case = 'parent_deceased'
      then 'parent-death-certificate' else 'sole-disposition-authority' end;
    select lr.id, re.id into v_review_id, v_evidence_id
    from public.legal_reviews lr
    join public.reviewed_evidence re on re.review_id = lr.id
    where lr.target_kind = 'single_parent_basis'
      and lr.target_id = v_draft.id
      and lr.decision = 'approved'
      and re.evidence_kind = v_evidence_kind
      and re.purged_at is null
    order by lr.review_revision desc, re.evidence_revision desc
    limit 1;
    if v_review_id is null then
      v_missing := array_append(v_missing, 'reviewed-evidence');
    end if;
  end if;

  if v_draft.upload_class = 'embryo_third_party' and not exists (
    select 1 from public.consent_signatures cs
    where cs.signer_principal_id = v_draft.uploader_principal_id
      and cs.artifact_key = 'consent.upload-embryo'
      and cs.artifact_version = v_upload_version
      and cs.purpose = 'embryo-upload-uploader-class'
      and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
  ) then
    v_missing := array_append(v_missing, 'upload-embryo');
  end if;

  if p_insurance_ack_id is null or not exists (
    select 1 from public.consent_signatures cs
    where cs.id = p_insurance_ack_id
      and cs.signer_principal_id = v_draft.uploader_principal_id
      and cs.signer_account_id = p_account_id
      and cs.artifact_key = 'disclosure.insurance-and-discrimination'
      and cs.artifact_version = v_disclosure_version
      and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
  ) then
    v_missing := array_append(v_missing, 'insurance-disclosure');
  end if;
  if p_charter_ack_id is null or not exists (
    select 1 from public.consent_signatures cs
    where cs.id = p_charter_ack_id
      and cs.signer_principal_id = v_draft.uploader_principal_id
      and cs.signer_account_id = p_account_id
      and cs.artifact_key = 'charter.future-person'
      and cs.artifact_version = v_charter_version
      and cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id
  ) then
    v_missing := array_append(v_missing, 'future-person-charter');
  end if;

  if cardinality(v_missing) > 0 then
    select array_agg(distinct m order by m) into v_missing from unnest(v_missing) as m;
    raise exception using
      errcode = '55000',
      message = 'consent_required',
      detail = array_to_string(v_missing, ',');
  end if;

  -- The acting parent must be a required principal (embryo_own) or the
  -- class-D uploader (embryo_third_party); ownership adds nothing else.
  v_actor_principal := private.acting_embryo_principal_v1(
    p_account_id, v_authority.required_upload_principals
  );
  if v_draft.upload_class = 'embryo_own' and v_actor_principal is null then
    raise exception using errcode = '42501', message = 'not a required principal';
  end if;

  select coalesce(array_agg(cs.id order by cs.id), '{}'::uuid[]) into v_signature_ids
  from public.consent_signatures cs
  where cs.target_kind = 'cohort_draft' and cs.target_id = v_draft.id;
  v_fingerprint := encode(extensions.digest(convert_to(
    concat_ws(':', v_authority.basis_case, v_draft.basis_revision::text,
      array_to_string(v_signature_ids, ',')),
    'UTF8'), 'sha256'), 'hex');

  insert into public.embryo_cohorts (
    draft_id, owner_account_id, upload_class, basis_case, basis_revision,
    participant_set_revision, donor_attribution_revision,
    recipient_set_revision, key_revision, lifecycle_revision, status,
    embryo_count, retention_expires_at
  ) values (
    v_draft.id, p_account_id, v_draft.upload_class, v_authority.basis_case,
    v_draft.basis_revision, 1, 1, 1, 1, 1, 'upload_pending',
    v_draft.embryo_count, v_retention_deadline
  ) returning id into v_cohort_id;

  foreach v_set_kind in array array[
    'required_upload_principals', 'disposition_authorities',
    'notice_recipients', 'record_key_recipients'
  ] loop
    foreach v_parent in array v_authority.required_upload_principals loop
      insert into public.embryo_participant_sets (
        cohort_id, set_kind, principal_id, set_revision, membership_revision
      ) values (v_cohort_id, v_set_kind, v_parent, 1, 1);
      insert into public.embryo_draft_participants (
        draft_id, set_kind, principal_id, set_revision, membership_revision
      ) values (v_draft.id, v_set_kind, v_parent, 1, 1)
      on conflict do nothing;
    end loop;
  end loop;

  insert into public.embryo_basis_bindings (
    cohort_id, basis_case, basis_revision, participant_set_revision,
    case_artifact_signature_id, reviewed_evidence_id, legal_review_id,
    artifact_matrix_fingerprint
  ) values (
    v_cohort_id, v_authority.basis_case, v_draft.basis_revision, 1,
    v_single_signature, v_evidence_id, v_review_id, v_fingerprint
  );

  insert into public.embryo_donor_attributions (
    cohort_id, donor_slot, classification, attribution_revision
  )
  select v_cohort_id, 'parent_b', 'anonymous', 1
  where v_authority.basis_case = 'anonymous_donor';

  for v_ordinal in 0..(v_draft.embryo_count - 1) loop
    insert into public.subjects (
      owner_account_id, subject_account_id, subject_class, upload_class,
      display_label, lifecycle, cohort_id
    ) values (
      p_account_id, null, 'embryo', v_draft.upload_class,
      'Embryo ' || (v_ordinal + 1)::text, 'quarantined', v_cohort_id
    ) returning id into v_subject_id;

    insert into public.embryos (
      cohort_id, subject_id, sample_ordinal, status, retention_expires_at,
      closing_date, closing_date_state, date_revision
    ) values (
      v_cohort_id, v_subject_id, v_ordinal, 'pending', v_retention_deadline,
      v_retention_deadline::date, 'provisional_until_terminal_ordinal_resolution', 1
    ) returning id into v_embryo_id;

    foreach v_recipient in array v_authority.record_key_recipients loop
      insert into public.future_person_record_key_print_rights (
        embryo_id, recipient_principal_id, recipient_set_revision,
        key_revision, status, delivery_kind
      ) values (v_embryo_id, v_recipient, 1, 1, 'unconsumed', 'initial');
    end loop;

    if v_actor_principal is not null then
      v_record_key := private.embryo_record_key_v1();
      insert into public.future_person_record_key_hashes (
        embryo_id, recipient_principal_id, recipient_set_revision,
        key_revision, key_hash, status
      ) values (
        v_embryo_id, v_actor_principal, 1, 1,
        encode(extensions.digest(convert_to(v_record_key, 'UTF8'), 'sha256'), 'hex'),
        'current'
      );
      update public.future_person_record_key_print_rights
      set status = 'consumed', consumed_at = v_now
      where embryo_id = v_embryo_id
        and recipient_principal_id = v_actor_principal
        and status = 'unconsumed';
      v_cards := v_cards || jsonb_build_object(
        'embryo_id', v_embryo_id,
        'display_label', 'Embryo ' || (v_ordinal + 1)::text,
        'record_key', v_record_key,
        'closing_date_iso', to_char(v_retention_deadline::date, 'YYYY-MM-DD'),
        'closing_date_state', 'provisional_until_terminal_ordinal_resolution',
        'date_revision', 1
      );
    end if;
  end loop;

  update public.embryo_cohort_drafts
  set state = 'finalized', finalized_at = v_now
  where id = v_draft.id;

  update public.retention_due_phases
  set status = 'cancelled', terminal_outcome_code = 'draft_finalized',
      completed_at = v_now
  where retention_id = 'embryo.cohort-draft-30d'
    and target_kind = 'cohort' and target_id = v_draft.id
    and status = 'pending';
  update public.purge_manifests pm
  set state = 'cancelled'
  from public.retention_rows rr
  where pm.retention_row_id = rr.id
    and rr.retention_id = 'embryo.cohort-draft-30d'
    and rr.target_kind = 'cohort' and rr.target_id = v_draft.id
    and pm.state = 'frozen';
  update public.retention_rows
  set state = 'cancelled', ended_at = v_now
  where retention_id = 'embryo.cohort-draft-30d'
    and target_kind = 'cohort' and target_id = v_draft.id
    and state in ('scheduled', 'active');

  perform private.append_legal_audit_event(
    'embryo.cohort.finalized', null, 'api.embryo-cohorts', 'accepted',
    jsonb_build_object(
      'basis_case', v_authority.basis_case,
      'embryo_count', v_draft.embryo_count,
      'caller_state', case when v_actor_principal is null
        then 'not_a_card_recipient' else 'delivered_inline' end
    )
  );

  return query select
    v_cohort_id, v_draft.embryo_count::integer, 1::bigint, 1::bigint,
    case when v_actor_principal is null
      then 'not_a_card_recipient' else 'delivered_inline' end,
    v_cards;
end;
$$;

revoke all on function public.finalize_embryo_cohort_v1(
  uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.finalize_embryo_cohort_v1(
  uuid, uuid, uuid, uuid, uuid, text
) to service_role;

-- api.embryo-record-key-cards: one-time delivery of the acting recipient's
-- own cards. Requires a session created within 15 minutes and MFA when
-- enrolled; consumes every unconsumed print right the recipient holds.
create or replace function public.deliver_embryo_record_key_cards_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_cohort_id uuid,
  p_token_nonce text
)
returns table (
  cohort_id uuid,
  recipient_set_revision bigint,
  key_revision bigint,
  cards jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_cohort public.embryo_cohorts%rowtype;
  v_recipient uuid;
  v_right record;
  v_record_key text;
  v_cards jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  perform private.validate_sensitive_account_session_v1(p_account_id, p_session_id);

  select c.* into v_cohort
  from public.embryo_cohorts c
  where c.id = p_cohort_id
  for update;
  if v_cohort.id is null
    or v_cohort.status not in ('upload_pending', 'ingesting', 'active')
  then
    raise exception using errcode = '42501', message = 'cohort unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'record_key_print',
    'cohort', v_cohort.id
  );

  v_recipient := private.acting_embryo_principal_v1(
    p_account_id, private.embryo_cohort_set_v1(v_cohort.id, 'record_key_recipients')
  );
  if v_recipient is null then
    raise exception using errcode = '42501', message = 'not a card recipient';
  end if;

  for v_right in
    select pr.id, pr.embryo_id, pr.key_revision, pr.delivery_kind,
           e.sample_ordinal, e.display_label, e.closing_date,
           e.closing_date_state, e.date_revision
    from public.future_person_record_key_print_rights pr
    join public.embryos e on e.id = pr.embryo_id
    where e.cohort_id = v_cohort.id
      and pr.recipient_principal_id = v_recipient
      and pr.recipient_set_revision = v_cohort.recipient_set_revision
      and pr.status = 'unconsumed'
    order by e.sample_ordinal
    for update of pr
  loop
    v_record_key := private.embryo_record_key_v1();
    update public.future_person_record_key_hashes
    set status = 'revoked', ended_at = v_now
    where embryo_id = v_right.embryo_id
      and recipient_principal_id = v_recipient
      and status = 'current';
    insert into public.future_person_record_key_hashes (
      embryo_id, recipient_principal_id, recipient_set_revision,
      key_revision, key_hash, status
    ) values (
      v_right.embryo_id, v_recipient, v_cohort.recipient_set_revision,
      v_right.key_revision,
      encode(extensions.digest(convert_to(v_record_key, 'UTF8'), 'sha256'), 'hex'),
      'current'
    );
    update public.future_person_record_key_print_rights
    set status = 'consumed', consumed_at = v_now
    where id = v_right.id;
    v_cards := v_cards || jsonb_build_object(
      'embryo_id', v_right.embryo_id,
      'display_label', v_right.display_label,
      'record_key', v_record_key,
      'closing_date_iso', to_char(v_right.closing_date, 'YYYY-MM-DD'),
      'closing_date_state', v_right.closing_date_state,
      'date_revision', v_right.date_revision,
      'delivery_kind', v_right.delivery_kind
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception using errcode = '42501', message = 'no unconsumed print right';
  end if;

  perform private.append_legal_audit_event(
    'embryo.record-key.delivered', null, 'api.embryo-record-key-cards',
    'accepted', jsonb_build_object('count', v_count)
  );

  return query select
    v_cohort.id, v_cohort.recipient_set_revision, v_cohort.key_revision, v_cards;
end;
$$;

revoke all on function public.deliver_embryo_record_key_cards_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.deliver_embryo_record_key_cards_v1(uuid, uuid, uuid, text)
  to service_role;

-- api.cohort-restrict (and its alias api.embryo-withdraw): make the
-- parent-controlled cohort material unreadable, revoke every Record Key and
-- print right, revoke the cohort's grants and notify every notice recipient.
-- Source-object purge belongs to the withdrawal slice.
create or replace function public.restrict_embryo_cohort_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_cohort_id uuid,
  p_token_nonce text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_cohort public.embryo_cohorts%rowtype;
  v_actor uuid;
  v_recipient uuid;
  v_grant record;
begin
  select c.* into v_cohort
  from public.embryo_cohorts c
  where c.id = p_cohort_id
  for update;
  if v_cohort.id is null then
    raise exception using errcode = '42501', message = 'cohort unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'cohort_restrict',
    'cohort', v_cohort.id
  );

  v_actor := private.acting_embryo_principal_v1(
    p_account_id, private.embryo_cohort_set_v1(v_cohort.id, 'disposition_authorities')
  );
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not a disposition authority';
  end if;
  if v_cohort.status not in ('upload_pending', 'ingesting', 'active') then
    raise exception using errcode = '55000', message = 'already restricted';
  end if;

  update public.embryo_cohorts
  set status = 'restricted', lifecycle_revision = lifecycle_revision + 1
  where id = v_cohort.id;

  update public.subjects
  set lifecycle = 'restricted', lifecycle_revision = lifecycle_revision + 1,
      updated_at = v_now
  where cohort_id = v_cohort.id and lifecycle <> 'purged';

  delete from public.embryo_figures f
  using public.embryo_scores sc, public.embryos e
  where f.finding_id = sc.id and sc.embryo_id = e.id and e.cohort_id = v_cohort.id;
  delete from public.embryo_scores sc
  using public.embryos e
  where sc.embryo_id = e.id and e.cohort_id = v_cohort.id;
  delete from public.embryo_qc q
  using public.embryos e
  where q.embryo_id = e.id and e.cohort_id = v_cohort.id;
  delete from public.embryo_variants v
  using public.embryos e
  where v.embryo_id = e.id and e.cohort_id = v_cohort.id;

  update public.future_person_record_key_hashes h
  set status = 'revoked', ended_at = v_now
  from public.embryos e
  where h.embryo_id = e.id and e.cohort_id = v_cohort.id and h.status = 'current';
  update public.future_person_record_key_print_rights pr
  set status = 'revoked'
  from public.embryos e
  where pr.embryo_id = e.id and e.cohort_id = v_cohort.id and pr.status = 'unconsumed';

  for v_grant in
    select pg.grant_id
    from public.purpose_grants pg
    where pg.target_kind = 'cohort' and pg.target_id = v_cohort.id
      and pg.revoked_at is null
    for update
  loop
    update public.purpose_grants
    set revoked_at = v_now, revocation_reason = 'cohort_restricted'
    where grant_id = v_grant.grant_id;
    update public.directional_grants
    set status = 'revoked', ended_at = v_now
    where grant_id = v_grant.grant_id and status = 'current';
  end loop;

  foreach v_recipient in array private.embryo_cohort_set_v1(v_cohort.id, 'notice_recipients') loop
    perform private.enqueue_embryo_principal_mail_v1(
      v_recipient, 'cohort-restriction-notice', 'cohort-restriction-notice',
      'cohort', v_cohort.id,
      jsonb_build_object('embryoCount', v_cohort.embryo_count),
      encode(extensions.digest(convert_to(
        concat_ws(':', 'cohort-restriction-notice', v_cohort.id::text,
          v_recipient::text), 'UTF8'), 'sha256'), 'hex'),
      v_now + interval '30 days', null, null
    );
  end loop;

  perform private.append_legal_audit_event(
    'embryo.cohort.restricted', null, 'api.cohort-restrict', 'accepted',
    jsonb_build_object('embryo_count', v_cohort.embryo_count)
  );
end;
$$;

revoke all on function public.restrict_embryo_cohort_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.restrict_embryo_cohort_v1(uuid, uuid, uuid, text)
  to service_role;

-- api.embryo-disposition: propose/confirm for a true two-parent cohort,
-- direct commit for a single-authority case. Every timestamp and deadline is
-- the database's; the request supplies only the action and the disposition.
create or replace function public.record_embryo_disposition_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_embryo_id uuid,
  p_action text,
  p_disposition text,
  p_proposal_id uuid,
  p_token_nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_embryo public.embryos%rowtype;
  v_cohort public.embryo_cohorts%rowtype;
  v_binding public.embryo_basis_bindings%rowtype;
  v_authorities uuid[];
  v_actor uuid;
  v_mode text;
  v_proposal public.embryo_disposition_proposals%rowtype;
  v_retention_id uuid;
  v_deadline timestamptz;
  v_recipient uuid;
  v_record_key text;
  v_card jsonb := 'null'::jsonb;
  v_caller_state text := 'not_a_card_recipient';
  v_result jsonb;
begin
  if p_action not in ('propose', 'confirm', 'commit-single-authority')
    or p_disposition not in ('stored', 'transferred', 'donated', 'discarded')
    or (p_action = 'confirm') <> (p_proposal_id is not null)
  then
    raise exception using errcode = '22023', message = 'invalid disposition request';
  end if;

  select e.* into v_embryo
  from public.embryos e
  where e.id = p_embryo_id
  for update;
  if v_embryo.id is null then
    raise exception using errcode = '42501', message = 'embryo unavailable';
  end if;
  select c.* into v_cohort
  from public.embryo_cohorts c
  where c.id = v_embryo.cohort_id
  for update;
  if v_cohort.status not in ('upload_pending', 'ingesting', 'active') then
    raise exception using errcode = '42501', message = 'cohort unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'embryo_disposition',
    'embryo', v_embryo.id
  );

  v_authorities := private.embryo_cohort_set_v1(v_cohort.id, 'disposition_authorities');
  v_actor := private.acting_embryo_principal_v1(p_account_id, v_authorities);
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not a disposition authority';
  end if;

  select b.* into v_binding from public.embryo_basis_bindings b where b.cohort_id = v_cohort.id;
  v_mode := case when v_binding.basis_case = 'true_two_parent'
    then 'two-parent-propose-confirm' else 'single-authority-direct' end;
  if (v_mode = 'two-parent-propose-confirm' and p_action = 'commit-single-authority')
    or (v_mode = 'single-authority-direct' and p_action <> 'commit-single-authority')
  then
    raise exception using errcode = '22023', message = 'action does not match the disposition mode';
  end if;

  -- The state machine: unknown → any; stored → transferred/donated/discarded.
  if not (
    v_embryo.status in ('pending', 'qc_pass', 'qc_marginal', 'qc_fail', 'excluded')
    or (v_embryo.status = 'stored' and p_disposition <> 'stored')
  ) then
    raise exception using errcode = '55000', message = 'disposition final';
  end if;

  if p_action = 'propose' then
    insert into public.embryo_disposition_proposals (
      embryo_id, proposer_principal_id, disposition, basis_revision,
      authority_set_revision, status, expires_at
    ) values (
      v_embryo.id, v_actor, p_disposition, v_cohort.basis_revision,
      v_cohort.participant_set_revision, 'pending', v_now + interval '7 days'
    ) returning * into v_proposal;

    insert into public.retention_rows (
      retention_id, target_kind, target_id, retention_revision,
      target_lifecycle_revision, disposition_revision, fixed_deadline, state
    ) values (
      'embryo.disposition-proposal-7d', 'subject', v_embryo.subject_id,
      v_embryo.disposition_revision, v_cohort.lifecycle_revision,
      v_embryo.disposition_revision, v_proposal.expires_at, 'scheduled'
    ) returning id into v_retention_id;
    insert into public.retention_due_phases (
      retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
      phase_deadline, target_kind, target_id, target_lifecycle_revision,
      disposition_revision, recipient_authority_kind,
      recipient_authority_revision, immutable_envelope
    ) values (
      v_retention_id, 'embryo.disposition-proposal-7d',
      'embryo-disposition-proposal-expiry', 'purge', 1, v_proposal.expires_at,
      'subject', v_embryo.subject_id, v_cohort.lifecycle_revision,
      v_embryo.disposition_revision, 'disposition-authorities',
      v_cohort.participant_set_revision,
      jsonb_build_object('proposalId', v_proposal.id)
    );
    insert into public.purge_manifests (
      retention_row_id, phase_id, phase_revision, manifest_class,
      manifest_revision, source_binding_fingerprint, state
    ) values (
      v_retention_id, 'embryo-disposition-proposal-expiry', 1, 'proposal-working', 1,
      encode(extensions.digest(convert_to(
        concat_ws(':', 'embryo-disposition-proposal-v1', v_proposal.id::text),
        'UTF8'), 'sha256'), 'hex'),
      'frozen'
    );

    perform private.append_legal_audit_event(
      'embryo.disposition.proposed', null, 'api.embryo-disposition', 'accepted',
      jsonb_build_object('disposition', p_disposition, 'mode', v_mode)
    );

    return jsonb_build_object(
      'status', 'awaiting_other_parent',
      'proposalId', v_proposal.id,
      'expiresAt', to_char(v_proposal.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  end if;

  if p_action = 'confirm' then
    select p.* into v_proposal
    from public.embryo_disposition_proposals p
    where p.id = p_proposal_id
      and p.embryo_id = v_embryo.id
      and p.status = 'pending'
      and p.expires_at > v_now
      and p.disposition = p_disposition
      and p.basis_revision = v_cohort.basis_revision
      and p.authority_set_revision = v_cohort.participant_set_revision
      and p.proposer_principal_id <> v_actor
    for update;
    if v_proposal.id is null then
      raise exception using errcode = '42501', message = 'proposal unavailable';
    end if;
    update public.embryo_disposition_proposals
    set status = 'confirmed', confirmed_at = v_now
    where id = v_proposal.id;
    update public.retention_due_phases
    set status = 'cancelled', terminal_outcome_code = 'proposal_confirmed',
        completed_at = v_now
    where retention_id = 'embryo.disposition-proposal-7d'
      and target_kind = 'subject' and target_id = v_embryo.subject_id
      and status = 'pending';
    update public.purge_manifests pm
    set state = 'cancelled'
    from public.retention_rows rr
    where pm.retention_row_id = rr.id
      and rr.retention_id = 'embryo.disposition-proposal-7d'
      and rr.target_kind = 'subject' and rr.target_id = v_embryo.subject_id
      and pm.state = 'frozen';
    update public.retention_rows
    set state = 'cancelled', ended_at = v_now
    where retention_id = 'embryo.disposition-proposal-7d'
      and target_kind = 'subject' and target_id = v_embryo.subject_id
      and state in ('scheduled', 'active');
  end if;

  -- Commit.
  update public.embryos
  set status = p_disposition,
      disposition_effective_at = v_now,
      disposition_revision = disposition_revision + 1
  where id = v_embryo.id
  returning * into v_embryo;

  if p_disposition in ('donated', 'discarded') then
    v_deadline := v_now + interval '90 days';
    update public.future_person_record_key_hashes
    set status = 'revoked', ended_at = v_now
    where embryo_id = v_embryo.id and status = 'current';
    update public.future_person_record_key_print_rights
    set status = 'revoked'
    where embryo_id = v_embryo.id and status = 'unconsumed';
    update public.embryos set retention_expires_at = v_deadline
    where id = v_embryo.id
    returning * into v_embryo;

    insert into public.retention_rows (
      retention_id, target_kind, target_id, retention_revision,
      target_lifecycle_revision, disposition_revision, fixed_deadline, state
    ) values (
      'embryo.donated-or-discarded-90d', 'subject', v_embryo.subject_id,
      v_embryo.disposition_revision, v_cohort.lifecycle_revision,
      v_embryo.disposition_revision, v_deadline, 'scheduled'
    ) returning id into v_retention_id;
    insert into public.retention_due_phases (
      retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
      phase_deadline, target_kind, target_id, target_lifecycle_revision,
      disposition_revision, recipient_authority_kind,
      recipient_authority_revision, immutable_envelope
    ) values
      (v_retention_id, 'embryo.donated-or-discarded-90d',
       'disposition-expiry-notice-30d', 'notice-enqueue', 1,
       v_deadline - interval '30 days', 'subject', v_embryo.subject_id,
       v_cohort.lifecycle_revision, v_embryo.disposition_revision,
       'notice-recipients', v_cohort.participant_set_revision, '{}'::jsonb),
      (v_retention_id, 'embryo.donated-or-discarded-90d',
       'disposition-expiry-deny', 'deny', 1, v_deadline, 'subject',
       v_embryo.subject_id, v_cohort.lifecycle_revision,
       v_embryo.disposition_revision, 'notice-recipients',
       v_cohort.participant_set_revision, '{}'::jsonb),
      (v_retention_id, 'embryo.donated-or-discarded-90d',
       'disposition-expiry-purge', 'purge', 1, v_deadline, 'subject',
       v_embryo.subject_id, v_cohort.lifecycle_revision,
       v_embryo.disposition_revision, 'notice-recipients',
       v_cohort.participant_set_revision, '{}'::jsonb);
    insert into public.purge_manifests (
      retention_row_id, phase_id, phase_revision, manifest_class,
      manifest_revision, source_binding_fingerprint, state
    ) values (
      v_retention_id, 'disposition-expiry-purge', 1, 'complete-retention', 1,
      encode(extensions.digest(convert_to(
        concat_ws(':', 'embryo-disposition-v1', v_embryo.id::text,
          v_embryo.disposition_revision::text), 'UTF8'), 'sha256'), 'hex'),
      'frozen'
    );
  elsif p_disposition = 'transferred' then
    v_deadline := v_now + interval '18 years 9 months' + interval '24 months';
    update public.future_person_record_key_hashes
    set status = 'revoked', ended_at = v_now
    where embryo_id = v_embryo.id and status = 'current';
    update public.future_person_record_key_print_rights
    set status = 'revoked'
    where embryo_id = v_embryo.id and status = 'unconsumed';
    update public.embryo_cohorts
    set recipient_set_revision = recipient_set_revision + 1,
        key_revision = key_revision + 1
    where id = v_cohort.id
    returning * into v_cohort;
    update public.embryos
    set transferred_at = v_now,
        retention_expires_at = v_deadline,
        closing_date = v_deadline::date,
        closing_date_state = 'definitive_transferred_claim_window',
        date_revision = date_revision + 1
    where id = v_embryo.id
    returning * into v_embryo;

    foreach v_recipient in array private.embryo_cohort_set_v1(v_cohort.id, 'record_key_recipients') loop
      insert into public.future_person_record_key_print_rights (
        embryo_id, recipient_principal_id, recipient_set_revision,
        key_revision, status, delivery_kind
      ) values (
        v_embryo.id, v_recipient, v_cohort.recipient_set_revision,
        v_cohort.key_revision, 'unconsumed', 'transfer_replacement'
      );
    end loop;

    if v_actor = any (private.embryo_cohort_set_v1(v_cohort.id, 'record_key_recipients')) then
      v_record_key := private.embryo_record_key_v1();
      insert into public.future_person_record_key_hashes (
        embryo_id, recipient_principal_id, recipient_set_revision,
        key_revision, key_hash, status
      ) values (
        v_embryo.id, v_actor, v_cohort.recipient_set_revision, v_cohort.key_revision,
        encode(extensions.digest(convert_to(v_record_key, 'UTF8'), 'sha256'), 'hex'),
        'current'
      );
      update public.future_person_record_key_print_rights
      set status = 'consumed', consumed_at = v_now
      where embryo_id = v_embryo.id and recipient_principal_id = v_actor
        and status = 'unconsumed';
      v_caller_state := 'delivered_inline';
      v_card := jsonb_build_object(
        'record_key', v_record_key,
        'closing_date_iso', to_char(v_embryo.closing_date, 'YYYY-MM-DD'),
        'closing_date_state', v_embryo.closing_date_state
      );
    end if;

    update public.purpose_grants
    set revoked_at = v_now, revocation_reason = 'embryo_transferred'
    where target_kind = 'cohort' and target_id = v_cohort.id and revoked_at is null;
    update public.directional_grants dg
    set status = 'revoked', ended_at = v_now
    from public.purpose_grants pg
    where dg.grant_id = pg.grant_id and pg.revocation_reason = 'embryo_transferred'
      and dg.status = 'current';

    insert into public.retention_rows (
      retention_id, target_kind, target_id, retention_revision,
      target_lifecycle_revision, disposition_revision, fixed_deadline, state
    ) values (
      'embryo.transferred-claim-window', 'subject', v_embryo.subject_id,
      v_embryo.disposition_revision, v_cohort.lifecycle_revision,
      v_embryo.disposition_revision, v_deadline, 'scheduled'
    ) returning id into v_retention_id;
    insert into public.retention_due_phases (
      retention_row_id, retention_id, phase_id, phase_kind, phase_revision,
      phase_deadline, target_kind, target_id, target_lifecycle_revision,
      disposition_revision, recipient_authority_kind,
      recipient_authority_revision, immutable_envelope
    )
    select v_retention_id, 'embryo.transferred-claim-window', x.phase_id, x.phase_kind, 1,
           x.deadline, 'subject', v_embryo.subject_id, v_cohort.lifecycle_revision,
           v_embryo.disposition_revision, 'notice-recipients',
           v_cohort.participant_set_revision, '{}'::jsonb
    from (values
      ('transferred-claim-window-open-notice', 'notice-enqueue', v_now + interval '17 years'),
      ('transferred-deletion-notice-90d', 'notice-enqueue', v_deadline - interval '90 days'),
      ('transferred-final-deletion-notice', 'notice-enqueue', v_deadline - interval '30 days'),
      ('transferred-closing-deny', 'deny', v_deadline),
      ('transferred-closing-purge', 'purge', v_deadline)
    ) as x(phase_id, phase_kind, deadline);
    insert into public.purge_manifests (
      retention_row_id, phase_id, phase_revision, manifest_class,
      manifest_revision, source_binding_fingerprint, state
    ) values (
      v_retention_id, 'transferred-closing-purge', 1, 'complete-retention', 1,
      encode(extensions.digest(convert_to(
        concat_ws(':', 'embryo-transfer-v1', v_embryo.id::text,
          v_embryo.disposition_revision::text), 'UTF8'), 'sha256'), 'hex'),
      'frozen'
    );
  end if;

  foreach v_recipient in array private.embryo_cohort_set_v1(v_cohort.id, 'notice_recipients') loop
    perform private.enqueue_embryo_principal_mail_v1(
      v_recipient, 'embryo-disposition-notice', 'embryo-disposition-notice',
      'subject', v_embryo.subject_id,
      jsonb_build_object(
        'displayLabel', v_embryo.display_label,
        'disposition', p_disposition,
        'effectiveAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'retentionExpiresAt', to_char(v_embryo.retention_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ),
      encode(extensions.digest(convert_to(
        concat_ws(':', 'embryo-disposition-notice', v_embryo.id::text,
          v_embryo.disposition_revision::text, v_recipient::text),
        'UTF8'), 'sha256'), 'hex'),
      v_now + interval '30 days', null, null
    );
  end loop;

  perform private.append_legal_audit_event(
    'embryo.disposition.recorded', null, 'api.embryo-disposition', 'accepted',
    jsonb_build_object('disposition', p_disposition, 'mode', v_mode)
  );

  v_result := jsonb_build_object(
    'embryoId', v_embryo.id,
    'disposition', p_disposition,
    'effectiveAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'retentionExpiresAt', to_char(v_embryo.retention_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  if p_disposition = 'transferred' then
    v_result := v_result || jsonb_build_object(
      'recipientSetRevision', v_cohort.recipient_set_revision,
      'callerState', v_caller_state,
      'card', v_card
    );
  end if;
  return v_result;
end;
$$;

revoke all on function public.record_embryo_disposition_v1(
  uuid, uuid, uuid, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.record_embryo_disposition_v1(
  uuid, uuid, uuid, text, text, uuid, text
) to service_role;

-- api.consents grant-purpose with cohortId: one embryo.analysis grant by one
-- required upload principal, in their own account. Analysis needs one from
-- every required principal; nothing is bundled or implied.
create or replace function public.grant_cohort_purpose_v1(
  p_account_id uuid,
  p_session_id uuid,
  p_cohort_id uuid,
  p_artifact_key text,
  p_artifact_version integer,
  p_statement_keys text[],
  p_signing_name_ciphertext bytea,
  p_jurisdiction_code text,
  p_token_nonce text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_cohort public.embryo_cohorts%rowtype;
  v_artifact public.consent_artifacts%rowtype;
  v_profile public.profiles%rowtype;
  v_actor uuid;
  v_grant_id uuid;
  v_signature_id uuid;
begin
  select c.* into v_cohort
  from public.embryo_cohorts c
  where c.id = p_cohort_id
  for update;
  if v_cohort.id is null or v_cohort.status not in ('upload_pending', 'ingesting', 'active') then
    raise exception using errcode = '42501', message = 'cohort unavailable';
  end if;

  perform private.consume_embryo_operation_nonce_v1(
    p_token_nonce, p_account_id, p_session_id, 'cohort_purpose_grant',
    'cohort', v_cohort.id
  );

  v_actor := private.acting_embryo_principal_v1(
    p_account_id, private.embryo_cohort_set_v1(v_cohort.id, 'required_upload_principals')
  );
  if v_actor is null then
    raise exception using errcode = '42501', message = 'not a required principal';
  end if;

  if p_artifact_key <> 'consent.upload-embryo'
    or p_signing_name_ciphertext is null
    or p_jurisdiction_code !~ '^[A-Z]{2}$'
    or p_statement_keys is distinct from
      private.embryo_statement_keys_v1('consent.upload-embryo', 'grant')
  then
    raise exception using errcode = '22023', message = 'invalid grant request';
  end if;
  v_artifact := private.current_embryo_artifact_v1(p_artifact_key, p_artifact_version);

  select pg.grant_id into v_grant_id
  from public.purpose_grants pg
  where pg.target_kind = 'cohort' and pg.target_id = v_cohort.id
    and pg.purpose = 'embryo.analysis'
    and pg.signer_principal_id = v_actor
    and pg.revoked_at is null
    and (pg.expires_at is null or pg.expires_at > v_now)
  limit 1;
  if v_grant_id is not null then
    return v_grant_id;
  end if;

  select * into v_profile from public.profiles where id = p_account_id;

  insert into public.consent_signatures (
    artifact_key, artifact_version, artifact_body_sha256,
    signer_principal_id, signer_account_id, target_kind, target_id,
    purpose, statement_keys, signing_name_encrypted,
    jurisdiction_code, jurisdiction_revision, subject_binding_revision
  ) values (
    v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
    v_actor, p_account_id, 'cohort', v_cohort.id,
    'embryo.analysis', p_statement_keys, p_signing_name_ciphertext,
    p_jurisdiction_code, coalesce(v_profile.jurisdiction_revision, 1),
    v_cohort.participant_set_revision
  ) returning id into v_signature_id;

  insert into public.purpose_grants (
    grant_revision, target_kind, target_id, purpose,
    artifact_key, artifact_version, artifact_body_sha256, signature_id,
    signer_principal_id, data_subject_principal_id, subject_binding_revision,
    jurisdiction_code, jurisdiction_revision
  ) values (
    1, 'cohort', v_cohort.id, 'embryo.analysis',
    v_artifact.artifact_key, v_artifact.version, v_artifact.body_sha256,
    v_signature_id, v_actor, v_actor, v_cohort.participant_set_revision,
    p_jurisdiction_code, coalesce(v_profile.jurisdiction_revision, 1)
  ) returning grant_id into v_grant_id;

  insert into public.directional_grants (
    grant_id, grant_revision, recipient_principal_id, recipient_account_id,
    relationship_or_pair_revision, direction, status
  ) values (
    v_grant_id, 1, v_actor, p_account_id, 1, 'self', 'current'
  );

  perform private.append_legal_audit_event(
    'purpose.granted', null, 'api.consents', 'accepted',
    jsonb_build_object('purpose', 'embryo.analysis', 'target_kind', 'cohort')
  );

  return v_grant_id;
end;
$$;

revoke all on function public.grant_cohort_purpose_v1(
  uuid, uuid, uuid, text, integer, text[], bytea, text, text
) from public, anon, authenticated;
grant execute on function public.grant_cohort_purpose_v1(
  uuid, uuid, uuid, text, integer, text[], bytea, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Job statistics, the draft-expiry executor and the column guard
-- ---------------------------------------------------------------------------

-- Turnaround figures for one job kind over the last 30 days. Percentiles
-- are withheld under 20 completed jobs so a page never prints a figure that
-- rests on a handful of runs.
create or replace function public.job_time_stats(p_kind text)
returns table (
  completed_count integer,
  p50_seconds integer,
  p90_seconds integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::integer,
    case when count(*) >= 20 then
      (percentile_cont(0.5) within group (
        order by extract(epoch from (j.finished_at - coalesce(j.started_at, j.created_at)))
      ))::integer end,
    case when count(*) >= 20 then
      (percentile_cont(0.9) within group (
        order by extract(epoch from (j.finished_at - coalesce(j.started_at, j.created_at)))
      ))::integer end
  from public.worker_jobs j
  where j.kind = p_kind
    and j.status = 'done'
    and j.finished_at is not null
    and j.finished_at > now() - interval '30 days';
$$;

revoke all on function public.job_time_stats(text) from public, anon;
grant execute on function public.job_time_stats(text) to authenticated, service_role;

-- jobs.retention: the embryo.cohort-draft-30d executor. At the fixed
-- deadline every linked invitation, credential and contact is terminalized
-- and the draft row is deleted; only tombstones and pseudonymized audit
-- remain. The caller mails the owner's terminal notice.
create or replace function public.run_due_embryo_retention_phases_v1()
returns table (
  draft_id uuid,
  owner_account_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_phase record;
  v_draft public.embryo_cohort_drafts%rowtype;
  v_principals uuid[];
begin
  for v_phase in
    select p.retention_row_id, p.phase_id, p.phase_revision, p.target_id
    from public.retention_due_phases p
    where p.retention_id = 'embryo.cohort-draft-30d'
      and p.phase_id = 'embryo-cohort-draft-expiry'
      and p.status = 'pending'
      and p.phase_deadline <= v_now
    order by p.phase_deadline
    for update skip locked
  loop
    select d.* into v_draft
    from public.embryo_cohort_drafts d
    where d.id = v_phase.target_id
    for update;

    if v_draft.id is null or v_draft.state not in ('draft', 'evidence_pending', 'ready') then
      update public.retention_due_phases
      set status = 'cancelled', terminal_outcome_code = 'draft_finalized',
          completed_at = v_now
      where retention_row_id = v_phase.retention_row_id
        and phase_id = v_phase.phase_id
        and phase_revision = v_phase.phase_revision;
      update public.purge_manifests set state = 'cancelled'
      where retention_row_id = v_phase.retention_row_id and state = 'frozen';
      update public.retention_rows set state = 'cancelled', ended_at = v_now
      where id = v_phase.retention_row_id and state in ('scheduled', 'active');
      continue;
    end if;

    select coalesce(array_agg(s.principal_id), '{}'::uuid[]) into v_principals
    from public.draft_participant_slots s
    where s.embryo_draft_id = v_draft.id and s.principal_id is not null;

    update public.subject_invitations
    set status = 'expired', terminal_at = v_now, email_encrypted = null
    where target_kind = 'cohort_draft' and target_id = v_draft.id
      and status = 'pending';
    update public.invitation_candidates ic
    set state = 'expired'
    from public.subject_invitations si
    where ic.invitation_id = si.id
      and si.target_kind = 'cohort_draft' and si.target_id = v_draft.id
      and ic.state in ('pending', 'issued');
    update public.token_hashes th
    set status = 'expired', ended_at = v_now
    from public.token_candidates tc
    join public.subject_invitations si on si.id = tc.target_id
    where th.candidate_id = tc.id
      and si.target_kind = 'cohort_draft' and si.target_id = v_draft.id
      and th.status = 'current';
    update public.token_candidates tc
    set state = 'expired'
    from public.subject_invitations si
    where tc.target_id = si.id
      and si.target_kind = 'cohort_draft' and si.target_id = v_draft.id
      and tc.state in ('pending', 'issued');
    update public.mail_outbox m
    set state = 'expired', claimed_at = null, last_outcome_code = 'expired'
    where m.recipient_principal_id = any (v_principals)
      and m.state in ('queued', 'claimed');
    update public.rights_sessions
    set status = 'expired', ended_at = v_now
    where target_kind = 'cohort_draft' and target_id = v_draft.id
      and status = 'active';
    update public.encrypted_contact_references
    set contact_ciphertext = null, status = 'shredded', ended_at = v_now
    where principal_id = any (v_principals) and status <> 'shredded';
    update public.contact_hmac_indexes chi
    set status = 'expired', expires_at = least(chi.expires_at, v_now)
    from public.encrypted_contact_references ecr
    where chi.contact_reference_id = ecr.id
      and ecr.principal_id = any (v_principals)
      and chi.status = 'current';
    update public.subject_principals
    set status = case when status = 'pending' then 'deleted' else 'revoked' end,
        principal_revision = principal_revision + 1
    where id = any (v_principals)
      and principal_kind = 'genetic_parent'
      and status in ('pending', 'active');

    delete from public.attestations
    where target_kind = 'cohort_draft' and target_id = v_draft.id;
    delete from public.consent_signatures
    where target_kind = 'cohort_draft' and target_id = v_draft.id;
    delete from public.embryo_cohort_drafts where id = v_draft.id;

    update public.retention_due_phases
    set status = 'succeeded', terminal_outcome_code = 'draft_expired',
        completed_at = v_now
    where retention_row_id = v_phase.retention_row_id
      and phase_id = v_phase.phase_id
      and phase_revision = v_phase.phase_revision;
    update public.purge_manifests set state = 'complete'
    where retention_row_id = v_phase.retention_row_id and state in ('frozen', 'executing');
    update public.retention_rows set state = 'complete', ended_at = v_now
    where id = v_phase.retention_row_id;

    perform private.append_legal_audit_event(
      'embryo.draft.expired', null, 'jobs.retention', 'accepted',
      jsonb_build_object('basis_case', v_draft.basis_case)
    );

    draft_id := v_draft.id;
    owner_account_id := v_draft.owner_account_id;
    return next;
  end loop;
  return;
end;
$$;

revoke all on function public.run_due_embryo_retention_phases_v1()
  from public, anon, authenticated;
grant execute on function public.run_due_embryo_retention_phases_v1()
  to service_role;

-- No embryo table may ever gain a sex, gender, karyotype, source-label or
-- header-derived column, even by a privileged writer. The guard runs after
-- every CREATE TABLE / ALTER TABLE and aborts the statement when such a
-- column exists on an embryo or future-person table.
create or replace function private.embryo_forbidden_columns_guard()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column record;
begin
  select c.table_name, c.column_name into v_column
  from information_schema.columns c
  where c.table_schema = 'public'
    and (c.table_name like 'embryo%' or c.table_name like 'future\_person%')
    and c.column_name in (
      'sex', 'gender', 'karyotype', 'biological_sex', 'source_label',
      'sample_label', 'lab_identifier', 'cycle_label', 'label_hash',
      'label_ciphertext', 'header_hash', 'header_hmac'
    )
  limit 1;
  if v_column.column_name is not null then
    raise exception using
      errcode = '42501',
      message = format('forbidden embryo column %s.%s', v_column.table_name, v_column.column_name);
  end if;
end;
$$;

revoke all on function private.embryo_forbidden_columns_guard() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'embryo_forbidden_columns_guard') then
    execute $et$
      create event trigger embryo_forbidden_columns_guard
      on ddl_command_end
      when tag in ('CREATE TABLE', 'ALTER TABLE', 'CREATE TABLE AS')
      execute function private.embryo_forbidden_columns_guard()
    $et$;
  end if;
exception when insufficient_privilege then
  raise notice 'embryo_forbidden_columns_guard not created: the migrating role may not create event triggers';
end;
$$;
