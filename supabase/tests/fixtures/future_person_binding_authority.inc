-- Shared exact documentary decision, mail activation and separate account-binding SQL boundary.
-- All existing binding assertions remain; synthetic SQL accounts are not browser Auth proof.
begin;
select no_plan();
\ir future_person_binding_lifecycle.inc
