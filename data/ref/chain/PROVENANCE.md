# GRCh37_to_GRCh38.chain.gz

- Source: https://ftp.ensembl.org/pub/assembly_mapping/homo_sapiens/GRCh37_to_GRCh38.chain.gz
- Retrieved: 2026-08-28 (curl -L, gzip integrity verified)
- Format: UCSC chain format; chromosome names without the "chr" prefix
  (Ensembl convention). Source coordinates are GRCh37, target GRCh38.
- Terms: Ensembl data are open access, free for all users without restriction
  (Apache 2.0 for code; data unrestricted). See
  https://www.ensembl.org/info/about/legal/disclaimer.html
- Consumed by src/lib/genome/liftover.ts (buildLiftover).
