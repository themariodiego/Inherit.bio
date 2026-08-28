// Release watchers for the research-library pipeline. Each returns the
// upstream's current release key so the job can detect "a new release
// happened" — these endpoints carry no user data in either direction.

export type ResearchSource = "gwas_catalog" | "pgs_catalog" | "clinvar";

export interface ReleaseInfo {
  source: ResearchSource;
  releaseKey: string;
  meta: Record<string, unknown>;
}

export async function fetchGwasRelease(): Promise<ReleaseInfo> {
  const res = await fetch("https://www.ebi.ac.uk/gwas/rest/api/metadata", {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GWAS metadata ${res.status}`);
  const json = (await res.json()) as {
    _embedded?: { mappingMetadatas?: { ensemblReleaseNumber?: number }[] };
    date?: string;
  };
  const meta = json._embedded?.mappingMetadatas?.[0] ?? {};
  const key =
    (meta as { associationCount?: number; ensemblReleaseNumber?: number })
      .ensemblReleaseNumber != null
      ? `ensembl-${(meta as { ensemblReleaseNumber: number }).ensemblReleaseNumber}`
      : (json.date ?? "unknown");
  return { source: "gwas_catalog", releaseKey: String(key), meta: meta as Record<string, unknown> };
}

export async function fetchPgsRelease(): Promise<ReleaseInfo> {
  const res = await fetch("https://www.pgscatalog.org/rest/info", {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`PGS info ${res.status}`);
  const json = (await res.json()) as {
    rest_api?: { version?: string };
    latest_release?: { date?: string; score_count?: number };
  };
  return {
    source: "pgs_catalog",
    releaseKey: json.latest_release?.date ?? "unknown",
    meta: (json.latest_release ?? {}) as Record<string, unknown>,
  };
}

export async function fetchClinvarRelease(): Promise<ReleaseInfo> {
  // NCBI eutils einfo reports ClinVar's last update date.
  const res = await fetch(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?db=clinvar&retmode=json",
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`ClinVar einfo ${res.status}`);
  const json = (await res.json()) as {
    einforesult?: { dbinfo?: { lastupdate?: string } };
  };
  return {
    source: "clinvar",
    releaseKey: json.einforesult?.dbinfo?.lastupdate ?? "unknown",
    meta: {},
  };
}

export const RELEASE_FETCHERS: Record<ResearchSource, () => Promise<ReleaseInfo>> = {
  gwas_catalog: fetchGwasRelease,
  pgs_catalog: fetchPgsRelease,
  clinvar: fetchClinvarRelease,
};
