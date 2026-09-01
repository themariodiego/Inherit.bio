-- Authorization depends on clock_timestamp() for grant expiry and must not be
-- treated as stable within a statement.

alter function private.resource_authorized_v1(
  uuid, text, uuid, text, bigint, bigint
) volatile;
