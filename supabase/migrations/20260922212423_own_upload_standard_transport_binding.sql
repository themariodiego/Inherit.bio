-- The browser grant carries one standard object create, not every provider
-- protocol that happens to call the same INSERT permission probe. Storage sets
-- this transaction-local value from its matched route, never a client header.
-- Missing or different operations fail closed. The completed-object service
-- trigger and its exact authority/size/owner checks remain unchanged.
alter policy genomes_upload_token_create_only on storage.objects
with check (
 current_setting('storage.operation',true)='storage.object.upload'
 and bucket_id='genomes'
 and name=(current_setting('request.jwt.claims',true)::jsonb->>'staging_key')
 and case when jsonb_typeof(coalesce(metadata->'size',metadata->'contentLength'))='number'
  then coalesce(metadata->>'size',metadata->>'contentLength')::numeric>0
   and coalesce(metadata->>'size',metadata->>'contentLength')::numeric<=(current_setting('request.jwt.claims',true)::jsonb->>'maximum_bytes')::numeric
  else false end
 and private.authorize_storage_upload_insert()
);
