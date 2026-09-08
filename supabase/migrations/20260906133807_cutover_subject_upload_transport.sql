-- Cut over together with the canonical browser and both API aliases. Existing
-- durable genome files and their download/deletion rights are unchanged.
-- Ordinary login bearers can no longer open a legacy resumable staging write.
drop policy genomes_staging_create_once on storage.objects;
