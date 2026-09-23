-- Existing closed zero-coverage content, shared by generation and Copilot tests.
-- Only the exact caller source binding varies; reference content is unchanged.
create function pg_temp.empty_ancestry_output(p_source jsonb) returns jsonb
language sql immutable as $$
 select jsonb_build_object('ancestry',jsonb_build_object(
 'schemaVersion',1,'computationRevision','own-ancestry-content-v1',
 'source',p_source,
 'panel','{"id":"aims-kidd-seldin-168","version":"2026-08-28","provenance":"data/ref/AIMS_PROVENANCE.md","markerSha256":"e8109eedd184ab1fd3dedf9385357bd64ec166c3c3597e04d0213c1e1ed7064b","markerCount":168,"minimumMarkers":42}'::jsonb,
 'admixture','{"kind":"admixture","result":{"proportions":{"AFR":0.2,"AMR":0.2,"EAS":0.2,"EUR":0.2,"SAS":0.2},"markersUsed":0,"note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable."},"support_note":"Low confidence: only 0 of 168 ancestry-informative markers had usable genotypes; proportions are unreliable.","model_id":"aims-kidd-seldin-168","model_version":"2026-08-28","coverage":0,"result_state":"not_covered","basis":"modelled","range":{"unavailable":true},"resolution":"five-broad-regions"}'::jsonb,
 'panelPositions','{"called":0,"missing":168,"noCall":0,"filtered":0,"conflicting":0,"unsupported":0}'::jsonb,
 'lineages','[{"kind":"mtdna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0},{"kind":"ydna","state":"unavailable","reason":"no_supplied_positions","observedPositions":0}]'::jsonb));
$$;
