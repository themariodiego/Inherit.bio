-- A separate, entirely invented fitted TEST experiment. Existing carrier,
-- clinical and coverage-only records/doors retain their original meaning.
-- No admission is installed by this migration; older admissions stay denied.
alter table private.embryo_test_statistical_admission
 add column fit_artifact_sha256 text,
 add column fit_artifact jsonb,
 add column fit_package jsonb,
 add column fit_package_digest text,
 add constraint embryo_test_statistical_fit_admission_closed check ((
  (fit_artifact_sha256 is null and fit_artifact is null and fit_package is null and fit_package_digest is null)
  or (fit_artifact_sha256='5355327cfe90cda24ca2d27cd3afab2e53d26b5d6995b69cb296d3b975c6d408'
   and fit_artifact is not null and fit_package is not null and fit_package_digest~'^[0-9a-f]{64}$')) is true);

-- Fixed decimal OUTPUT boundary only: round half away from zero at nine
-- fractional digits. Raw fitting and interval intermediates are never rounded.
-- Finite, bounded inputs; no tolerance or implicit negative-zero encoding.
create function private.embryo_test_fit_decimal_v1(p double precision) returns text
language plpgsql immutable set search_path='' as $decimal$
declare units bigint;
begin
 if p is null or not(p > '-Infinity'::double precision and p < 'Infinity'::double precision)
  or abs(p)>=1000000 then raise exception using errcode='22023',message='synthetic_fit_numeric_refused';end if;
 units:=floor(abs(p)*1000000000+0.5)::bigint;
 if units>=1000000000000000 then raise exception using errcode='22023',message='synthetic_fit_numeric_refused';end if;
 return case when p<0 and units<>0 then '-' else '' end||(units/1000000000)::text||'.'||lpad((units%1000000000)::text,9,'0');
end $decimal$;

create function private.embryo_test_fit_decimal_tree_v1(p jsonb) returns jsonb
language plpgsql immutable set search_path='' as $tree$
declare result jsonb:='[]'; row jsonb;
begin
 if jsonb_typeof(p)='number' then return to_jsonb(private.embryo_test_fit_decimal_v1((p#>>'{}')::double precision));end if;
 if jsonb_typeof(p) is distinct from 'array' then raise exception using errcode='22023',message='synthetic_fit_numeric_refused';end if;
 for row in select value from jsonb_array_elements(p) loop
  result:=result||jsonb_build_array(private.embryo_test_fit_decimal_tree_v1(row));
 end loop;
 return result;
end $tree$;

-- Digest grammar contains arrays/string leaves only. Encode each JSON string
-- using PostgreSQL JSON escaping; array separators have no whitespace.
create function private.embryo_test_fit_array_text_v1(p jsonb) returns text
language plpgsql immutable set search_path='' as $array_text$
declare result text:='['; row jsonb; separator text:='';
begin
 if jsonb_typeof(p)='string' then return p::text;end if;
 if jsonb_typeof(p) is distinct from 'array' then raise exception using errcode='22023',message='synthetic_fit_digest_refused';end if;
 for row in select value from jsonb_array_elements(p) loop
  result:=result||separator||private.embryo_test_fit_array_text_v1(row);separator:=',';
 end loop;
 return result||']';
end $array_text$;

create function private.embryo_test_fit_dot_v1(a double precision[],b double precision[]) returns double precision
language plpgsql immutable set search_path='' as $dot$
declare result double precision:=0; i integer;
begin
 if array_length(a,1) is distinct from array_length(b,1) or array_length(a,1) is null then
  raise exception using errcode='22023',message='synthetic_fit_shape_refused';end if;
 for i in 1..array_length(a,1) loop result:=result+a[i]*b[i];end loop;
 return result;
end $dot$;

create function private.embryo_test_fit_r2_v1(observed double precision[],predicted double precision[]) returns double precision
language plpgsql immutable set search_path='' as $r2$
declare center double precision:=0; total double precision:=0; error double precision:=0; i integer; n integer:=array_length(observed,1);
begin
 if n is null or n<3 or n is distinct from array_length(predicted,1) then
  raise exception using errcode='22023',message='synthetic_fit_shape_refused';end if;
 for i in 1..n loop center:=center+observed[i];end loop;center:=center/n;
 for i in 1..n loop total:=total+(observed[i]-center)^2;error:=error+(observed[i]-predicted[i])^2;end loop;
 if total<=0 then raise exception using errcode='22023',message='synthetic_fit_rank_refused';end if;
 return 1-error/total;
end $r2$;

create function private.embryo_test_fit_quadratic_v1(x double precision[],covariance jsonb) returns double precision
language plpgsql immutable set search_path='' as $quadratic$
declare row double precision[]; products double precision[]:='{}'; result double precision; i integer; j integer; n integer:=array_length(x,1);
begin
 if n is null or jsonb_array_length(covariance)<>n then raise exception using errcode='22023',message='synthetic_fit_shape_refused';end if;
 for i in 1..n loop
  if jsonb_array_length(covariance->(i-1))<>n then raise exception using errcode='22023',message='synthetic_fit_shape_refused';end if;
  row:='{}';for j in 1..n loop row:=array_append(row,(covariance#>>array[(i-1)::text,(j-1)::text])::double precision);end loop;
  products:=array_append(products,private.embryo_test_fit_dot_v1(row,x));
 end loop;
 result:=private.embryo_test_fit_dot_v1(x,products);
 if result < -1e-10 then raise exception using errcode='22023',message='synthetic_fit_covariance_refused';end if;
 return greatest(0,result);
end $quadratic$;

-- Fixed-order double arithmetic mirrors the pure source algorithm, including
-- complete 11x11 inverse, 10x10 reference covariance and 256 holdout resamples.
-- p_artifact must equal the ENTIRE source literal before any fitting occurs.
create function private.embryo_test_fit_package_raw_v1(p_artifact jsonb) returns jsonb
language plpgsql immutable set search_path='' set extra_float_digits=3 as $fit$
declare a jsonb; centers double precision[]:=array_fill(0::double precision,array[10]);
 design double precision[][]:=array_fill(0::double precision,array[64,11]);
 work double precision[][]:=array_fill(0::double precision,array[11,22]);
 rhs double precision[]:=array_fill(0::double precision,array[11]);
 coefficients double precision[]:=array_fill(0::double precision,array[11]);
 reference_cov double precision[][]:=array_fill(0::double precision,array[10,10]);
 fit_cov double precision[][]:=array_fill(0::double precision,array[11,11]);
 observed double precision[]:='{}'; predicted double precision[]:='{}';
 sampled_o double precision[]; sampled_p double precision[]; boot double precision[]:='{}';
 pair_o double precision[]:='{}';pair_p double precision[]:='{}';
 i integer; j integer; k integer; r integer; pivot integer; idx integer; state bigint:=606;
 value double precision; scale double precision; factor double precision; swap double precision;
 residual_variance double precision:=0; prediction double precision; pair_predictions double precision[];
 z double precision:=1.959963984540054; point double precision; denom double precision; center double precision; half double precision;
 low double precision; high double precision; position double precision; lower_i integer; upper_i integer; events integer:=0;
begin
 if p_artifact is distinct from private.embryo_test_fit_artifact_v1() then
  raise exception using errcode='22023',message='synthetic_fit_artifact_refused';end if;
 a:=p_artifact;
 for i in 1..10 loop
  for r in 0..95 loop centers[i]:=centers[i]+(a#>>array['reference',r::text,'dosages',(i-1)::text])::double precision;end loop;
  centers[i]:=centers[i]/96;
 end loop;
 for i in 1..10 loop for j in 1..10 loop
  for r in 0..95 loop reference_cov[i][j]:=reference_cov[i][j]
   +((a#>>array['reference',r::text,'dosages',(i-1)::text])::double precision-centers[i])
    *((a#>>array['reference',r::text,'dosages',(j-1)::text])::double precision-centers[j]);end loop;
  reference_cov[i][j]:=reference_cov[i][j]/95;
 end loop;end loop;
 for r in 1..64 loop design[r][1]:=1;
  for i in 2..11 loop design[r][i]:=(a#>>array['training',(r-1)::text,'dosages',(i-2)::text])::double precision-centers[i-1];end loop;
 end loop;
 for i in 1..11 loop
  for j in 1..11 loop
   for r in 1..64 loop work[i][j]:=work[i][j]+design[r][i]*design[r][j];end loop;
   work[i][j+11]:=case when i=j then 1 else 0 end;
  end loop;
  for r in 1..64 loop rhs[i]:=rhs[i]+design[r][i]*(a#>>array['training',(r-1)::text,'liability'])::double precision;end loop;
 end loop;
 for k in 1..11 loop
  pivot:=k;
  for r in (k+1)..11 loop if abs(work[r][k])>abs(work[pivot][k]) then pivot:=r;end if;end loop;
  if abs(work[pivot][k])<1e-12 then raise exception using errcode='22023',message='synthetic_fit_rank_refused';end if;
  for j in 1..22 loop swap:=work[k][j];work[k][j]:=work[pivot][j];work[pivot][j]:=swap;end loop;
  scale:=work[k][k];for j in 1..22 loop work[k][j]:=work[k][j]/scale;end loop;
  for r in 1..11 loop if r<>k then
   factor:=work[r][k];for j in 1..22 loop work[r][j]:=work[r][j]-factor*work[k][j];end loop;
  end if;end loop;
 end loop;
 for i in 1..11 loop for j in 1..11 loop coefficients[i]:=coefficients[i]+work[i][j+11]*rhs[j];end loop;end loop;
 for r in 1..64 loop
  prediction:=0;for j in 1..11 loop prediction:=prediction+design[r][j]*coefficients[j];end loop;
  value:=(a#>>array['training',(r-1)::text,'liability'])::double precision-prediction;
  residual_variance:=residual_variance+value*value;
 end loop;residual_variance:=residual_variance/53;
 for i in 1..11 loop for j in 1..11 loop fit_cov[i][j]:=work[i][j+11]*residual_variance;end loop;end loop;
 for r in 0..47 loop
  prediction:=coefficients[1];
  for i in 1..10 loop prediction:=prediction+((a#>>array['holdout',r::text,'dosages',(i-1)::text])::double precision-centers[i])*coefficients[i+1];end loop;
  observed:=array_append(observed,(a#>>array['holdout',r::text,'liability'])::double precision);predicted:=array_append(predicted,prediction);
 end loop;
 for k in 1..256 loop
  sampled_o:='{}';sampled_p:='{}';
  for r in 1..48 loop state:=(state*1664525+1013904223)%4294967296;idx:=floor(state::double precision/4294967296*48)::integer+1;
   sampled_o:=array_append(sampled_o,observed[idx]);sampled_p:=array_append(sampled_p,predicted[idx]);end loop;
  boot:=array_append(boot,private.embryo_test_fit_r2_v1(sampled_o,sampled_p));
 end loop;
 select array_agg(v order by v) into boot from unnest(boot) v;
 position:=.025*255;lower_i:=floor(position)::integer+1;upper_i:=ceil(position)::integer+1;
 low:=boot[lower_i]+(boot[upper_i]-boot[lower_i])*(position-floor(position));
 position:=.975*255;lower_i:=floor(position)::integer+1;upper_i:=ceil(position)::integer+1;
 high:=boot[lower_i]+(boot[upper_i]-boot[lower_i])*(position-floor(position));
 -- Artifact order is fixed: each adjacent pair is an invented algorithm control.
 for k in 0..15 loop
  pair_predictions:='{}';
  for r in (2*k)..(2*k+1) loop
   prediction:=coefficients[1];for i in 1..10 loop prediction:=prediction
    +((a#>>array['familyControls',r::text,'dosages',(i-1)::text])::double precision-centers[i])*coefficients[i+1];end loop;
   pair_predictions:=array_append(pair_predictions,prediction);
  end loop;
  pair_o:=array_append(pair_o,(a#>>array['familyControls',(2*k)::text,'liability'])::double precision
   -(a#>>array['familyControls',(2*k+1)::text,'liability'])::double precision);
  pair_p:=array_append(pair_p,pair_predictions[1]-pair_predictions[2]);
 end loop;
 for r in 0..199 loop if (a#>>array['calibration',r::text,'event'])::boolean then events:=events+1;end if;end loop;
 point:=events::double precision/200;denom:=1+z^2/200;center:=(point+z^2/400)/denom;
 half:=z*sqrt(point*(1-point)/200+z^2/(4*200^2))/denom;
 return jsonb_build_object('version','embryo-synthetic-fit-package-v1','provenance',a->'provenance',
  'panelId',a->'panelId','sexBasis',a->'sexBasis','ageBand',a->'ageBand','birthCohort',a->'birthCohort','calibrationCohort',a->'calibrationCohort',
  'fit',jsonb_build_object('coefficients',coefficients,'covariance',fit_cov,'residualVariance',residual_variance,'degreesOfFreedom',53,'observations',64),
  'holdout',jsonb_build_object('r2',private.embryo_test_fit_r2_v1(observed,predicted),'interval',jsonb_build_array(low,high),'n',48,'method','invented-holdout-percentile-bootstrap-256'),
  'reference',jsonb_build_object('centers',centers,'covariance',reference_cov,'n',96),
  'baseline',jsonb_build_object('point',point,'interval',jsonb_build_array(center-half,center+half),'n',200,'events',events,'method','invented-binary-Wilson-95'),
  'internalInventedPairControls',jsonb_build_object('r2',private.embryo_test_fit_r2_v1(pair_o,pair_p),'pairs',16,'evidence','invented-pairs-not-human-siblings'),
  'withinFamily','{"status":"not_measured","enabledByDefault":false,"betaRatio":null,"interval":null,"familyCount":null,"citation":null}'::jsonb,
  'publicationEligible',false,'clinicalRegistryEligible',false);
end $fit$;

create function private.embryo_test_fit_package_v1(p_artifact jsonb) returns jsonb
language plpgsql immutable set search_path='' as $canonical_package$
declare p jsonb:=private.embryo_test_fit_package_raw_v1(p_artifact); path text[];
begin
 foreach path slice 1 in array array[['fit','coefficients'],['fit','covariance'],['fit','residualVariance'],
  ['holdout','r2'],['holdout','interval'],['reference','centers'],['reference','covariance'],
  ['baseline','point'],['baseline','interval'],['internalInventedPairControls','r2']] loop
  p:=jsonb_set(p,path,private.embryo_test_fit_decimal_tree_v1(p#>path));
 end loop;
 return p;
end $canonical_package$;

create function private.embryo_test_fit_package_digest_v1(p jsonb) returns text
language sql immutable set search_path='' as $digest$
 select encode(extensions.digest(convert_to(private.embryo_test_fit_array_text_v1(jsonb_build_array(
  p->'version',p#>'{fit,coefficients}',p#>'{fit,covariance}',p#>'{fit,residualVariance}',
  p#>'{holdout,r2}',p#>'{holdout,interval}',p#>'{reference,centers}',p#>'{reference,covariance}',
  p#>'{baseline,point}',p#>'{baseline,interval}',p#>'{internalInventedPairControls,r2}')),'UTF8'),'sha256'),'hex');
$digest$;

-- Complete immutable invented population; no caller-selected training rows.
create function private.embryo_test_fit_artifact_v1() returns jsonb
language sql immutable set search_path='' as $artifact$
 select $fixed_artifact${
  "version": "embryo-synthetic-fit-v1",
  "purpose": "pure-fitting-controls-only",
  "provenance": "entirely-invented-no-human-observations",
  "panelId": "synthetic-score-coverage-v1",
  "panelSourceSha256": "c08fcfea75896e134cfc68ac844bedc0f5aa3b7a4b5623d97806297978df984f",
  "variantIds": [
    "synthetic-row-01",
    "synthetic-row-02",
    "synthetic-row-03",
    "synthetic-row-04",
    "synthetic-row-05",
    "synthetic-row-06",
    "synthetic-row-07",
    "synthetic-row-08",
    "synthetic-row-09",
    "synthetic-row-10"
  ],
  "sexBasis": "combined",
  "ageBand": "lifetime",
  "birthCohort": "Invented combined-sex lifetime toy cohort",
  "calibrationCohort": "Invented binary calibration controls",
  "construction": {
    "algorithm": "lcg1664525-1013904223-u32-v1",
    "trainingSeed": 101,
    "holdoutSeed": 202,
    "referenceSeed": 303,
    "familySeed": 404,
    "calibrationSeed": 505,
    "outcome": "invented-linear-signal-plus-bounded-noise",
    "familyDesign": "arbitrary-invented-pairs-not-siblings",
    "bootstrapSeed": 606,
    "bootstrapReplicates": 256
  },
  "training": [
    {
      "id": "train-001",
      "dosages": [
        0,
        1,
        2,
        1,
        2,
        0,
        2,
        0,
        2,
        1
      ],
      "liability": -0.16079361
    },
    {
      "id": "train-002",
      "dosages": [
        2,
        0,
        0,
        0,
        1,
        0,
        2,
        1,
        0,
        0
      ],
      "liability": 0.284967179
    },
    {
      "id": "train-003",
      "dosages": [
        0,
        1,
        2,
        2,
        1,
        0,
        0,
        1,
        2,
        2
      ],
      "liability": -0.213842775
    },
    {
      "id": "train-004",
      "dosages": [
        1,
        0,
        2,
        0,
        0,
        2,
        1,
        0,
        2,
        0
      ],
      "liability": 0.431660226
    },
    {
      "id": "train-005",
      "dosages": [
        0,
        0,
        0,
        1,
        1,
        0,
        1,
        0,
        2,
        1
      ],
      "liability": -0.5176939
    },
    {
      "id": "train-006",
      "dosages": [
        0,
        2,
        1,
        2,
        1,
        1,
        0,
        0,
        0,
        0
      ],
      "liability": -0.646734998
    },
    {
      "id": "train-007",
      "dosages": [
        2,
        2,
        1,
        2,
        2,
        2,
        2,
        1,
        0,
        0
      ],
      "liability": 0.186038673
    },
    {
      "id": "train-008",
      "dosages": [
        2,
        2,
        1,
        2,
        1,
        0,
        2,
        1,
        2,
        2
      ],
      "liability": -0.49867729
    },
    {
      "id": "train-009",
      "dosages": [
        1,
        2,
        0,
        1,
        2,
        2,
        2,
        2,
        1,
        1
      ],
      "liability": -0.373491255
    },
    {
      "id": "train-010",
      "dosages": [
        2,
        1,
        0,
        0,
        2,
        1,
        1,
        1,
        2,
        1
      ],
      "liability": 0.334868544
    },
    {
      "id": "train-011",
      "dosages": [
        1,
        2,
        0,
        0,
        1,
        1,
        1,
        0,
        2,
        1
      ],
      "liability": -0.409240304
    },
    {
      "id": "train-012",
      "dosages": [
        2,
        0,
        1,
        2,
        1,
        0,
        2,
        0,
        2,
        2
      ],
      "liability": 0.214859636
    },
    {
      "id": "train-013",
      "dosages": [
        2,
        1,
        2,
        0,
        0,
        0,
        0,
        1,
        0,
        1
      ],
      "liability": 0.368991659
    },
    {
      "id": "train-014",
      "dosages": [
        2,
        1,
        2,
        2,
        0,
        0,
        1,
        0,
        2,
        1
      ],
      "liability": 0.254390363
    },
    {
      "id": "train-015",
      "dosages": [
        1,
        0,
        2,
        0,
        2,
        2,
        0,
        1,
        1,
        0
      ],
      "liability": 1.031870948
    },
    {
      "id": "train-016",
      "dosages": [
        2,
        1,
        2,
        1,
        0,
        0,
        1,
        0,
        2,
        1
      ],
      "liability": 0.188708667
    },
    {
      "id": "train-017",
      "dosages": [
        1,
        1,
        0,
        2,
        2,
        2,
        0,
        2,
        1,
        0
      ],
      "liability": 0.240106309
    },
    {
      "id": "train-018",
      "dosages": [
        2,
        2,
        2,
        0,
        2,
        2,
        1,
        0,
        2,
        0
      ],
      "liability": 0.53443771
    },
    {
      "id": "train-019",
      "dosages": [
        2,
        0,
        1,
        0,
        0,
        1,
        0,
        1,
        2,
        2
      ],
      "liability": 0.832219776
    },
    {
      "id": "train-020",
      "dosages": [
        0,
        1,
        0,
        0,
        0,
        2,
        1,
        0,
        2,
        2
      ],
      "liability": -0.550327237
    },
    {
      "id": "train-021",
      "dosages": [
        1,
        0,
        1,
        1,
        2,
        0,
        1,
        2,
        0,
        1
      ],
      "liability": 0.366517944
    },
    {
      "id": "train-022",
      "dosages": [
        1,
        2,
        1,
        2,
        1,
        2,
        1,
        1,
        0,
        1
      ],
      "liability": -0.559236107
    },
    {
      "id": "train-023",
      "dosages": [
        0,
        2,
        2,
        2,
        0,
        0,
        0,
        1,
        0,
        0
      ],
      "liability": -0.717277318
    },
    {
      "id": "train-024",
      "dosages": [
        1,
        1,
        1,
        2,
        2,
        0,
        2,
        2,
        0,
        0
      ],
      "liability": -0.197389391
    },
    {
      "id": "train-025",
      "dosages": [
        2,
        0,
        0,
        0,
        1,
        0,
        1,
        1,
        0,
        0
      ],
      "liability": 0.302548368
    },
    {
      "id": "train-026",
      "dosages": [
        2,
        2,
        1,
        2,
        2,
        1,
        2,
        1,
        1,
        2
      ],
      "liability": -0.247814731
    },
    {
      "id": "train-027",
      "dosages": [
        2,
        2,
        1,
        0,
        0,
        2,
        0,
        1,
        1,
        1
      ],
      "liability": 0.311715903
    },
    {
      "id": "train-028",
      "dosages": [
        1,
        2,
        0,
        1,
        1,
        0,
        2,
        2,
        0,
        0
      ],
      "liability": -0.405232332
    },
    {
      "id": "train-029",
      "dosages": [
        2,
        1,
        0,
        0,
        2,
        2,
        0,
        2,
        2,
        1
      ],
      "liability": 0.813471839
    },
    {
      "id": "train-030",
      "dosages": [
        2,
        1,
        1,
        0,
        0,
        1,
        1,
        0,
        2,
        2
      ],
      "liability": 0.464013859
    },
    {
      "id": "train-031",
      "dosages": [
        2,
        2,
        1,
        2,
        1,
        0,
        0,
        2,
        1,
        1
      ],
      "liability": -0.159365872
    },
    {
      "id": "train-032",
      "dosages": [
        0,
        1,
        0,
        1,
        2,
        1,
        1,
        2,
        0,
        2
      ],
      "liability": -0.344502135
    },
    {
      "id": "train-033",
      "dosages": [
        1,
        1,
        0,
        2,
        1,
        2,
        2,
        2,
        0,
        2
      ],
      "liability": -0.52548591
    },
    {
      "id": "train-034",
      "dosages": [
        0,
        2,
        1,
        0,
        2,
        0,
        0,
        1,
        2,
        1
      ],
      "liability": -0.226244403
    },
    {
      "id": "train-035",
      "dosages": [
        0,
        2,
        2,
        1,
        2,
        1,
        1,
        0,
        1,
        1
      ],
      "liability": -0.520232668
    },
    {
      "id": "train-036",
      "dosages": [
        0,
        1,
        0,
        1,
        0,
        2,
        2,
        1,
        1,
        2
      ],
      "liability": -0.659874113
    },
    {
      "id": "train-037",
      "dosages": [
        1,
        2,
        2,
        0,
        0,
        1,
        0,
        2,
        1,
        1
      ],
      "liability": 0.029304484
    },
    {
      "id": "train-038",
      "dosages": [
        1,
        0,
        1,
        2,
        2,
        2,
        0,
        1,
        0,
        2
      ],
      "liability": 0.32782419
    },
    {
      "id": "train-039",
      "dosages": [
        1,
        1,
        0,
        0,
        2,
        0,
        2,
        0,
        0,
        1
      ],
      "liability": -0.432154265
    },
    {
      "id": "train-040",
      "dosages": [
        2,
        0,
        2,
        0,
        1,
        1,
        0,
        1,
        2,
        1
      ],
      "liability": 1.026700117
    },
    {
      "id": "train-041",
      "dosages": [
        0,
        0,
        2,
        2,
        1,
        2,
        0,
        0,
        0,
        2
      ],
      "liability": 0.011531278
    },
    {
      "id": "train-042",
      "dosages": [
        2,
        1,
        0,
        0,
        0,
        2,
        2,
        1,
        2,
        1
      ],
      "liability": 0.348020613
    },
    {
      "id": "train-043",
      "dosages": [
        1,
        0,
        0,
        2,
        2,
        0,
        2,
        1,
        0,
        1
      ],
      "liability": -0.050797109
    },
    {
      "id": "train-044",
      "dosages": [
        2,
        2,
        0,
        1,
        2,
        0,
        0,
        0,
        0,
        2
      ],
      "liability": -0.105613816
    },
    {
      "id": "train-045",
      "dosages": [
        1,
        1,
        0,
        2,
        0,
        2,
        1,
        2,
        1,
        0
      ],
      "liability": -0.426449971
    },
    {
      "id": "train-046",
      "dosages": [
        0,
        2,
        0,
        2,
        0,
        0,
        1,
        2,
        2,
        1
      ],
      "liability": -0.833471772
    },
    {
      "id": "train-047",
      "dosages": [
        0,
        1,
        0,
        1,
        0,
        2,
        0,
        0,
        1,
        1
      ],
      "liability": -0.577733104
    },
    {
      "id": "train-048",
      "dosages": [
        0,
        0,
        0,
        2,
        2,
        1,
        0,
        1,
        1,
        0
      ],
      "liability": -0.277748853
    },
    {
      "id": "train-049",
      "dosages": [
        1,
        0,
        1,
        0,
        0,
        2,
        1,
        0,
        1,
        1
      ],
      "liability": 0.135695114
    },
    {
      "id": "train-050",
      "dosages": [
        1,
        1,
        0,
        0,
        1,
        2,
        2,
        2,
        0,
        1
      ],
      "liability": 0.198173524
    },
    {
      "id": "train-051",
      "dosages": [
        1,
        0,
        2,
        0,
        1,
        0,
        2,
        1,
        1,
        1
      ],
      "liability": 0.553129726
    },
    {
      "id": "train-052",
      "dosages": [
        0,
        0,
        1,
        0,
        2,
        0,
        0,
        2,
        2,
        1
      ],
      "liability": 0.397188298
    },
    {
      "id": "train-053",
      "dosages": [
        2,
        0,
        0,
        2,
        1,
        1,
        1,
        2,
        2,
        0
      ],
      "liability": 0.530044381
    },
    {
      "id": "train-054",
      "dosages": [
        2,
        2,
        1,
        0,
        0,
        1,
        0,
        2,
        2,
        2
      ],
      "liability": 0.358702483
    },
    {
      "id": "train-055",
      "dosages": [
        1,
        1,
        0,
        2,
        0,
        2,
        1,
        0,
        1,
        2
      ],
      "liability": -0.442055301
    },
    {
      "id": "train-056",
      "dosages": [
        1,
        0,
        2,
        2,
        1,
        0,
        1,
        1,
        1,
        2
      ],
      "liability": 0.099732591
    },
    {
      "id": "train-057",
      "dosages": [
        1,
        1,
        1,
        1,
        0,
        1,
        2,
        1,
        0,
        0
      ],
      "liability": -0.067613082
    },
    {
      "id": "train-058",
      "dosages": [
        1,
        1,
        1,
        1,
        1,
        1,
        0,
        1,
        1,
        0
      ],
      "liability": -0.052177425
    },
    {
      "id": "train-059",
      "dosages": [
        1,
        1,
        2,
        2,
        1,
        0,
        0,
        1,
        1,
        1
      ],
      "liability": 0.077902056
    },
    {
      "id": "train-060",
      "dosages": [
        1,
        2,
        1,
        0,
        2,
        2,
        0,
        0,
        2,
        2
      ],
      "liability": 0.276516697
    },
    {
      "id": "train-061",
      "dosages": [
        0,
        2,
        0,
        0,
        2,
        2,
        0,
        1,
        2,
        2
      ],
      "liability": -0.313856045
    },
    {
      "id": "train-062",
      "dosages": [
        2,
        2,
        2,
        1,
        0,
        2,
        2,
        0,
        0,
        0
      ],
      "liability": 0.035760375
    },
    {
      "id": "train-063",
      "dosages": [
        1,
        0,
        2,
        2,
        0,
        0,
        1,
        1,
        1,
        1
      ],
      "liability": 0.110532678
    },
    {
      "id": "train-064",
      "dosages": [
        0,
        0,
        0,
        1,
        2,
        1,
        2,
        2,
        1,
        2
      ],
      "liability": -0.071882316
    }
  ],
  "holdout": [
    {
      "id": "holdout-001",
      "dosages": [
        0,
        1,
        0,
        0,
        0,
        1,
        1,
        2,
        0,
        0
      ],
      "liability": -0.430277416
    },
    {
      "id": "holdout-002",
      "dosages": [
        0,
        2,
        0,
        0,
        1,
        1,
        1,
        2,
        2,
        0
      ],
      "liability": -0.536747799
    },
    {
      "id": "holdout-003",
      "dosages": [
        2,
        2,
        2,
        1,
        0,
        1,
        0,
        2,
        0,
        1
      ],
      "liability": 0.393979005
    },
    {
      "id": "holdout-004",
      "dosages": [
        2,
        0,
        0,
        1,
        0,
        1,
        0,
        0,
        2,
        1
      ],
      "liability": 0.227037855
    },
    {
      "id": "holdout-005",
      "dosages": [
        0,
        2,
        0,
        0,
        1,
        0,
        2,
        2,
        0,
        1
      ],
      "liability": -0.920904149
    },
    {
      "id": "holdout-006",
      "dosages": [
        1,
        1,
        1,
        2,
        2,
        2,
        2,
        0,
        2,
        0
      ],
      "liability": -0.093504281
    },
    {
      "id": "holdout-007",
      "dosages": [
        0,
        0,
        1,
        1,
        0,
        2,
        1,
        2,
        0,
        0
      ],
      "liability": 0.171910499
    },
    {
      "id": "holdout-008",
      "dosages": [
        0,
        1,
        0,
        2,
        1,
        2,
        1,
        2,
        2,
        2
      ],
      "liability": -0.487234169
    },
    {
      "id": "holdout-009",
      "dosages": [
        2,
        0,
        0,
        2,
        0,
        0,
        2,
        0,
        2,
        1
      ],
      "liability": -0.044951008
    },
    {
      "id": "holdout-010",
      "dosages": [
        0,
        1,
        0,
        1,
        0,
        2,
        2,
        0,
        1,
        0
      ],
      "liability": -0.675816774
    },
    {
      "id": "holdout-011",
      "dosages": [
        0,
        1,
        0,
        0,
        0,
        1,
        1,
        2,
        0,
        2
      ],
      "liability": -0.33031593
    },
    {
      "id": "holdout-012",
      "dosages": [
        0,
        0,
        0,
        0,
        0,
        2,
        2,
        0,
        1,
        2
      ],
      "liability": -0.474460742
    },
    {
      "id": "holdout-013",
      "dosages": [
        0,
        0,
        2,
        0,
        1,
        0,
        1,
        1,
        0,
        1
      ],
      "liability": 0.179939926
    },
    {
      "id": "holdout-014",
      "dosages": [
        0,
        1,
        0,
        0,
        2,
        2,
        0,
        1,
        0,
        1
      ],
      "liability": -0.26006797
    },
    {
      "id": "holdout-015",
      "dosages": [
        1,
        2,
        1,
        0,
        0,
        1,
        0,
        0,
        0,
        0
      ],
      "liability": -0.303917646
    },
    {
      "id": "holdout-016",
      "dosages": [
        1,
        0,
        0,
        2,
        1,
        0,
        2,
        1,
        0,
        2
      ],
      "liability": -0.410944449
    },
    {
      "id": "holdout-017",
      "dosages": [
        0,
        2,
        1,
        0,
        1,
        2,
        1,
        0,
        0,
        2
      ],
      "liability": -0.665976391
    },
    {
      "id": "holdout-018",
      "dosages": [
        2,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        0,
        2
      ],
      "liability": 0.348480345
    },
    {
      "id": "holdout-019",
      "dosages": [
        2,
        0,
        1,
        1,
        2,
        1,
        0,
        1,
        0,
        2
      ],
      "liability": 0.615936874
    },
    {
      "id": "holdout-020",
      "dosages": [
        2,
        2,
        2,
        0,
        2,
        0,
        0,
        2,
        1,
        1
      ],
      "liability": 0.669556374
    },
    {
      "id": "holdout-021",
      "dosages": [
        2,
        1,
        0,
        2,
        0,
        2,
        0,
        0,
        0,
        1
      ],
      "liability": -0.204084102
    },
    {
      "id": "holdout-022",
      "dosages": [
        1,
        0,
        2,
        2,
        2,
        0,
        2,
        2,
        1,
        1
      ],
      "liability": 0.374022261
    },
    {
      "id": "holdout-023",
      "dosages": [
        1,
        1,
        1,
        2,
        0,
        2,
        2,
        0,
        0,
        1
      ],
      "liability": -0.429369027
    },
    {
      "id": "holdout-024",
      "dosages": [
        0,
        0,
        0,
        1,
        1,
        1,
        1,
        0,
        0,
        1
      ],
      "liability": -0.333767083
    },
    {
      "id": "holdout-025",
      "dosages": [
        0,
        2,
        2,
        2,
        0,
        0,
        0,
        2,
        0,
        2
      ],
      "liability": -0.527176958
    },
    {
      "id": "holdout-026",
      "dosages": [
        2,
        0,
        1,
        0,
        0,
        0,
        1,
        1,
        1,
        1
      ],
      "liability": 0.546120822
    },
    {
      "id": "holdout-027",
      "dosages": [
        2,
        0,
        1,
        0,
        0,
        0,
        2,
        0,
        2,
        2
      ],
      "liability": 0.500243367
    },
    {
      "id": "holdout-028",
      "dosages": [
        1,
        2,
        0,
        0,
        0,
        1,
        0,
        1,
        0,
        2
      ],
      "liability": -0.311415709
    },
    {
      "id": "holdout-029",
      "dosages": [
        0,
        1,
        2,
        1,
        1,
        2,
        1,
        2,
        2,
        1
      ],
      "liability": 0.239286799
    },
    {
      "id": "holdout-030",
      "dosages": [
        0,
        0,
        2,
        1,
        0,
        2,
        0,
        1,
        0,
        1
      ],
      "liability": 0.106949242
    },
    {
      "id": "holdout-031",
      "dosages": [
        2,
        2,
        2,
        0,
        2,
        2,
        0,
        0,
        1,
        2
      ],
      "liability": 0.656082325
    },
    {
      "id": "holdout-032",
      "dosages": [
        2,
        2,
        2,
        1,
        1,
        0,
        0,
        1,
        0,
        1
      ],
      "liability": 0.094479052
    },
    {
      "id": "holdout-033",
      "dosages": [
        2,
        1,
        0,
        2,
        1,
        2,
        0,
        0,
        2,
        1
      ],
      "liability": 0.273195183
    },
    {
      "id": "holdout-034",
      "dosages": [
        1,
        0,
        1,
        1,
        1,
        2,
        0,
        1,
        2,
        0
      ],
      "liability": 0.703610241
    },
    {
      "id": "holdout-035",
      "dosages": [
        2,
        0,
        2,
        1,
        1,
        1,
        1,
        0,
        1,
        0
      ],
      "liability": 0.772360476
    },
    {
      "id": "holdout-036",
      "dosages": [
        2,
        2,
        1,
        1,
        0,
        2,
        0,
        1,
        1,
        0
      ],
      "liability": 0.122669852
    },
    {
      "id": "holdout-037",
      "dosages": [
        1,
        2,
        1,
        0,
        1,
        1,
        0,
        2,
        1,
        1
      ],
      "liability": 0.107808824
    },
    {
      "id": "holdout-038",
      "dosages": [
        0,
        2,
        2,
        0,
        1,
        0,
        2,
        0,
        0,
        2
      ],
      "liability": -0.640716499
    },
    {
      "id": "holdout-039",
      "dosages": [
        2,
        1,
        2,
        1,
        1,
        1,
        1,
        2,
        1,
        2
      ],
      "liability": 0.685760233
    },
    {
      "id": "holdout-040",
      "dosages": [
        1,
        1,
        0,
        0,
        2,
        0,
        1,
        1,
        1,
        2
      ],
      "liability": -0.22648879
    },
    {
      "id": "holdout-041",
      "dosages": [
        2,
        1,
        1,
        0,
        2,
        0,
        2,
        0,
        0,
        1
      ],
      "liability": 0.338552967
    },
    {
      "id": "holdout-042",
      "dosages": [
        0,
        0,
        0,
        0,
        0,
        1,
        1,
        2,
        1,
        0
      ],
      "liability": -0.073048742
    },
    {
      "id": "holdout-043",
      "dosages": [
        0,
        2,
        0,
        2,
        2,
        1,
        2,
        0,
        0,
        1
      ],
      "liability": -0.848360145
    },
    {
      "id": "holdout-044",
      "dosages": [
        2,
        0,
        2,
        2,
        0,
        0,
        0,
        2,
        2,
        2
      ],
      "liability": 0.551630411
    },
    {
      "id": "holdout-045",
      "dosages": [
        0,
        2,
        0,
        1,
        0,
        2,
        1,
        0,
        0,
        1
      ],
      "liability": -0.946674917
    },
    {
      "id": "holdout-046",
      "dosages": [
        0,
        0,
        1,
        0,
        2,
        1,
        1,
        0,
        1,
        0
      ],
      "liability": 0.029452009
    },
    {
      "id": "holdout-047",
      "dosages": [
        0,
        2,
        0,
        0,
        0,
        1,
        1,
        0,
        0,
        0
      ],
      "liability": -0.984369879
    },
    {
      "id": "holdout-048",
      "dosages": [
        1,
        2,
        2,
        2,
        1,
        1,
        1,
        2,
        0,
        1
      ],
      "liability": -0.355698471
    }
  ],
  "reference": [
    {
      "id": "reference-001",
      "dosages": [
        1,
        2,
        0,
        2,
        0,
        0,
        2,
        0,
        1,
        2
      ]
    },
    {
      "id": "reference-002",
      "dosages": [
        0,
        1,
        0,
        0,
        2,
        0,
        2,
        2,
        1,
        2
      ]
    },
    {
      "id": "reference-003",
      "dosages": [
        1,
        2,
        1,
        0,
        1,
        0,
        2,
        0,
        1,
        0
      ]
    },
    {
      "id": "reference-004",
      "dosages": [
        0,
        1,
        0,
        0,
        0,
        0,
        2,
        0,
        1,
        0
      ]
    },
    {
      "id": "reference-005",
      "dosages": [
        0,
        2,
        1,
        0,
        1,
        2,
        1,
        2,
        0,
        0
      ]
    },
    {
      "id": "reference-006",
      "dosages": [
        0,
        2,
        1,
        1,
        2,
        0,
        0,
        0,
        1,
        2
      ]
    },
    {
      "id": "reference-007",
      "dosages": [
        1,
        0,
        1,
        1,
        0,
        2,
        0,
        2,
        2,
        1
      ]
    },
    {
      "id": "reference-008",
      "dosages": [
        1,
        0,
        2,
        2,
        1,
        1,
        2,
        0,
        2,
        1
      ]
    },
    {
      "id": "reference-009",
      "dosages": [
        2,
        1,
        0,
        0,
        1,
        1,
        2,
        2,
        2,
        2
      ]
    },
    {
      "id": "reference-010",
      "dosages": [
        0,
        1,
        1,
        0,
        2,
        1,
        2,
        2,
        0,
        2
      ]
    },
    {
      "id": "reference-011",
      "dosages": [
        1,
        1,
        2,
        0,
        0,
        0,
        1,
        1,
        1,
        0
      ]
    },
    {
      "id": "reference-012",
      "dosages": [
        0,
        0,
        2,
        1,
        2,
        1,
        0,
        2,
        1,
        1
      ]
    },
    {
      "id": "reference-013",
      "dosages": [
        0,
        0,
        0,
        1,
        2,
        2,
        0,
        1,
        2,
        2
      ]
    },
    {
      "id": "reference-014",
      "dosages": [
        2,
        1,
        0,
        1,
        1,
        1,
        0,
        1,
        1,
        1
      ]
    },
    {
      "id": "reference-015",
      "dosages": [
        1,
        1,
        1,
        0,
        2,
        0,
        2,
        0,
        0,
        0
      ]
    },
    {
      "id": "reference-016",
      "dosages": [
        0,
        2,
        2,
        2,
        2,
        2,
        2,
        2,
        2,
        1
      ]
    },
    {
      "id": "reference-017",
      "dosages": [
        2,
        0,
        2,
        1,
        0,
        2,
        2,
        0,
        0,
        1
      ]
    },
    {
      "id": "reference-018",
      "dosages": [
        0,
        1,
        0,
        0,
        2,
        0,
        2,
        2,
        1,
        1
      ]
    },
    {
      "id": "reference-019",
      "dosages": [
        2,
        1,
        1,
        1,
        2,
        1,
        2,
        2,
        1,
        2
      ]
    },
    {
      "id": "reference-020",
      "dosages": [
        0,
        2,
        1,
        2,
        1,
        1,
        0,
        1,
        0,
        0
      ]
    },
    {
      "id": "reference-021",
      "dosages": [
        0,
        2,
        0,
        0,
        1,
        0,
        0,
        1,
        1,
        1
      ]
    },
    {
      "id": "reference-022",
      "dosages": [
        0,
        0,
        2,
        0,
        0,
        0,
        1,
        0,
        2,
        2
      ]
    },
    {
      "id": "reference-023",
      "dosages": [
        1,
        1,
        1,
        2,
        2,
        0,
        0,
        1,
        0,
        0
      ]
    },
    {
      "id": "reference-024",
      "dosages": [
        1,
        2,
        2,
        1,
        1,
        2,
        0,
        2,
        2,
        2
      ]
    },
    {
      "id": "reference-025",
      "dosages": [
        1,
        1,
        0,
        0,
        0,
        0,
        2,
        0,
        0,
        1
      ]
    },
    {
      "id": "reference-026",
      "dosages": [
        1,
        2,
        1,
        2,
        2,
        1,
        0,
        1,
        0,
        0
      ]
    },
    {
      "id": "reference-027",
      "dosages": [
        0,
        1,
        1,
        1,
        2,
        0,
        1,
        2,
        0,
        1
      ]
    },
    {
      "id": "reference-028",
      "dosages": [
        0,
        2,
        1,
        2,
        1,
        2,
        1,
        2,
        0,
        0
      ]
    },
    {
      "id": "reference-029",
      "dosages": [
        1,
        1,
        2,
        2,
        2,
        2,
        0,
        2,
        0,
        0
      ]
    },
    {
      "id": "reference-030",
      "dosages": [
        1,
        2,
        0,
        2,
        0,
        1,
        0,
        1,
        1,
        0
      ]
    },
    {
      "id": "reference-031",
      "dosages": [
        0,
        2,
        0,
        2,
        2,
        0,
        0,
        2,
        1,
        2
      ]
    },
    {
      "id": "reference-032",
      "dosages": [
        1,
        1,
        1,
        0,
        0,
        0,
        1,
        1,
        0,
        2
      ]
    },
    {
      "id": "reference-033",
      "dosages": [
        2,
        2,
        0,
        0,
        2,
        0,
        0,
        2,
        2,
        0
      ]
    },
    {
      "id": "reference-034",
      "dosages": [
        0,
        1,
        1,
        0,
        1,
        1,
        1,
        0,
        1,
        2
      ]
    },
    {
      "id": "reference-035",
      "dosages": [
        0,
        2,
        1,
        2,
        0,
        1,
        2,
        0,
        1,
        0
      ]
    },
    {
      "id": "reference-036",
      "dosages": [
        1,
        0,
        2,
        1,
        0,
        1,
        1,
        1,
        1,
        1
      ]
    },
    {
      "id": "reference-037",
      "dosages": [
        1,
        0,
        0,
        2,
        0,
        2,
        0,
        1,
        1,
        1
      ]
    },
    {
      "id": "reference-038",
      "dosages": [
        0,
        1,
        0,
        1,
        1,
        1,
        2,
        0,
        1,
        2
      ]
    },
    {
      "id": "reference-039",
      "dosages": [
        0,
        1,
        1,
        2,
        1,
        2,
        0,
        2,
        2,
        0
      ]
    },
    {
      "id": "reference-040",
      "dosages": [
        1,
        0,
        1,
        2,
        1,
        2,
        2,
        0,
        2,
        0
      ]
    },
    {
      "id": "reference-041",
      "dosages": [
        0,
        1,
        0,
        1,
        0,
        1,
        2,
        0,
        0,
        2
      ]
    },
    {
      "id": "reference-042",
      "dosages": [
        1,
        2,
        1,
        1,
        0,
        2,
        2,
        2,
        0,
        1
      ]
    },
    {
      "id": "reference-043",
      "dosages": [
        2,
        1,
        1,
        1,
        0,
        2,
        1,
        0,
        2,
        0
      ]
    },
    {
      "id": "reference-044",
      "dosages": [
        0,
        0,
        0,
        1,
        0,
        1,
        1,
        1,
        0,
        2
      ]
    },
    {
      "id": "reference-045",
      "dosages": [
        0,
        1,
        1,
        0,
        0,
        0,
        2,
        1,
        0,
        2
      ]
    },
    {
      "id": "reference-046",
      "dosages": [
        0,
        2,
        0,
        1,
        2,
        2,
        2,
        1,
        0,
        0
      ]
    },
    {
      "id": "reference-047",
      "dosages": [
        0,
        2,
        0,
        1,
        0,
        2,
        2,
        2,
        0,
        2
      ]
    },
    {
      "id": "reference-048",
      "dosages": [
        2,
        1,
        0,
        2,
        0,
        1,
        0,
        2,
        0,
        2
      ]
    },
    {
      "id": "reference-049",
      "dosages": [
        1,
        1,
        0,
        1,
        2,
        1,
        0,
        1,
        1,
        1
      ]
    },
    {
      "id": "reference-050",
      "dosages": [
        1,
        0,
        2,
        0,
        1,
        1,
        0,
        0,
        1,
        0
      ]
    },
    {
      "id": "reference-051",
      "dosages": [
        2,
        1,
        1,
        1,
        0,
        2,
        1,
        2,
        2,
        1
      ]
    },
    {
      "id": "reference-052",
      "dosages": [
        2,
        2,
        1,
        1,
        2,
        1,
        1,
        1,
        2,
        2
      ]
    },
    {
      "id": "reference-053",
      "dosages": [
        2,
        1,
        0,
        2,
        0,
        2,
        2,
        2,
        1,
        0
      ]
    },
    {
      "id": "reference-054",
      "dosages": [
        1,
        2,
        2,
        1,
        2,
        0,
        2,
        2,
        1,
        0
      ]
    },
    {
      "id": "reference-055",
      "dosages": [
        1,
        2,
        1,
        1,
        0,
        2,
        1,
        1,
        2,
        2
      ]
    },
    {
      "id": "reference-056",
      "dosages": [
        1,
        1,
        0,
        2,
        2,
        0,
        1,
        1,
        0,
        1
      ]
    },
    {
      "id": "reference-057",
      "dosages": [
        2,
        1,
        2,
        0,
        0,
        0,
        1,
        0,
        1,
        1
      ]
    },
    {
      "id": "reference-058",
      "dosages": [
        2,
        1,
        2,
        0,
        1,
        0,
        1,
        0,
        1,
        2
      ]
    },
    {
      "id": "reference-059",
      "dosages": [
        2,
        0,
        0,
        1,
        1,
        1,
        0,
        0,
        2,
        2
      ]
    },
    {
      "id": "reference-060",
      "dosages": [
        0,
        2,
        1,
        1,
        1,
        2,
        0,
        1,
        1,
        2
      ]
    },
    {
      "id": "reference-061",
      "dosages": [
        2,
        0,
        2,
        1,
        1,
        2,
        2,
        2,
        0,
        2
      ]
    },
    {
      "id": "reference-062",
      "dosages": [
        1,
        0,
        0,
        1,
        2,
        1,
        1,
        0,
        2,
        0
      ]
    },
    {
      "id": "reference-063",
      "dosages": [
        0,
        1,
        1,
        1,
        1,
        1,
        2,
        2,
        0,
        1
      ]
    },
    {
      "id": "reference-064",
      "dosages": [
        1,
        1,
        0,
        0,
        2,
        2,
        1,
        2,
        1,
        2
      ]
    },
    {
      "id": "reference-065",
      "dosages": [
        0,
        1,
        2,
        0,
        0,
        2,
        1,
        0,
        2,
        1
      ]
    },
    {
      "id": "reference-066",
      "dosages": [
        2,
        1,
        0,
        1,
        0,
        2,
        1,
        0,
        2,
        1
      ]
    },
    {
      "id": "reference-067",
      "dosages": [
        0,
        2,
        2,
        2,
        1,
        0,
        0,
        1,
        0,
        0
      ]
    },
    {
      "id": "reference-068",
      "dosages": [
        2,
        0,
        2,
        0,
        0,
        1,
        1,
        1,
        2,
        0
      ]
    },
    {
      "id": "reference-069",
      "dosages": [
        2,
        0,
        1,
        1,
        1,
        0,
        0,
        2,
        1,
        2
      ]
    },
    {
      "id": "reference-070",
      "dosages": [
        2,
        1,
        2,
        0,
        1,
        0,
        0,
        2,
        0,
        1
      ]
    },
    {
      "id": "reference-071",
      "dosages": [
        1,
        1,
        2,
        0,
        0,
        2,
        1,
        0,
        2,
        1
      ]
    },
    {
      "id": "reference-072",
      "dosages": [
        0,
        0,
        0,
        2,
        0,
        2,
        1,
        2,
        2,
        0
      ]
    },
    {
      "id": "reference-073",
      "dosages": [
        2,
        1,
        1,
        2,
        1,
        1,
        2,
        0,
        0,
        2
      ]
    },
    {
      "id": "reference-074",
      "dosages": [
        2,
        0,
        0,
        2,
        1,
        2,
        0,
        0,
        2,
        0
      ]
    },
    {
      "id": "reference-075",
      "dosages": [
        2,
        1,
        2,
        2,
        1,
        1,
        1,
        2,
        0,
        1
      ]
    },
    {
      "id": "reference-076",
      "dosages": [
        1,
        1,
        0,
        0,
        0,
        0,
        2,
        2,
        0,
        0
      ]
    },
    {
      "id": "reference-077",
      "dosages": [
        1,
        2,
        0,
        1,
        0,
        0,
        2,
        0,
        0,
        0
      ]
    },
    {
      "id": "reference-078",
      "dosages": [
        1,
        1,
        0,
        2,
        0,
        2,
        2,
        1,
        0,
        1
      ]
    },
    {
      "id": "reference-079",
      "dosages": [
        1,
        2,
        2,
        2,
        1,
        2,
        2,
        1,
        1,
        2
      ]
    },
    {
      "id": "reference-080",
      "dosages": [
        0,
        2,
        0,
        0,
        1,
        1,
        1,
        2,
        1,
        2
      ]
    },
    {
      "id": "reference-081",
      "dosages": [
        1,
        2,
        0,
        1,
        1,
        2,
        0,
        0,
        1,
        2
      ]
    },
    {
      "id": "reference-082",
      "dosages": [
        1,
        0,
        2,
        0,
        2,
        1,
        2,
        1,
        0,
        1
      ]
    },
    {
      "id": "reference-083",
      "dosages": [
        0,
        1,
        0,
        1,
        0,
        0,
        0,
        0,
        2,
        0
      ]
    },
    {
      "id": "reference-084",
      "dosages": [
        2,
        0,
        1,
        0,
        0,
        0,
        1,
        1,
        1,
        1
      ]
    },
    {
      "id": "reference-085",
      "dosages": [
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        2,
        0,
        1
      ]
    },
    {
      "id": "reference-086",
      "dosages": [
        1,
        1,
        1,
        2,
        0,
        2,
        1,
        0,
        1,
        1
      ]
    },
    {
      "id": "reference-087",
      "dosages": [
        1,
        2,
        1,
        2,
        0,
        2,
        0,
        2,
        2,
        2
      ]
    },
    {
      "id": "reference-088",
      "dosages": [
        2,
        1,
        1,
        2,
        0,
        2,
        0,
        0,
        2,
        2
      ]
    },
    {
      "id": "reference-089",
      "dosages": [
        0,
        0,
        1,
        2,
        2,
        0,
        2,
        0,
        1,
        2
      ]
    },
    {
      "id": "reference-090",
      "dosages": [
        1,
        0,
        1,
        1,
        2,
        2,
        2,
        1,
        2,
        0
      ]
    },
    {
      "id": "reference-091",
      "dosages": [
        2,
        0,
        2,
        0,
        1,
        1,
        0,
        2,
        1,
        1
      ]
    },
    {
      "id": "reference-092",
      "dosages": [
        0,
        0,
        1,
        0,
        1,
        2,
        2,
        1,
        1,
        2
      ]
    },
    {
      "id": "reference-093",
      "dosages": [
        0,
        0,
        2,
        2,
        2,
        2,
        0,
        2,
        2,
        2
      ]
    },
    {
      "id": "reference-094",
      "dosages": [
        2,
        2,
        0,
        1,
        2,
        2,
        1,
        2,
        2,
        0
      ]
    },
    {
      "id": "reference-095",
      "dosages": [
        1,
        2,
        2,
        1,
        0,
        1,
        1,
        2,
        1,
        0
      ]
    },
    {
      "id": "reference-096",
      "dosages": [
        0,
        1,
        1,
        2,
        0,
        2,
        1,
        0,
        1,
        1
      ]
    }
  ],
  "familyControls": [
    {
      "id": "family-001",
      "dosages": [
        1,
        2,
        1,
        1,
        1,
        2,
        1,
        2,
        0,
        2
      ],
      "liability": -0.33924503,
      "familyId": "invented-pair-01"
    },
    {
      "id": "family-002",
      "dosages": [
        1,
        0,
        1,
        0,
        2,
        1,
        1,
        0,
        2,
        2
      ],
      "liability": 0.669822247,
      "familyId": "invented-pair-01"
    },
    {
      "id": "family-003",
      "dosages": [
        0,
        0,
        1,
        2,
        0,
        1,
        1,
        1,
        2,
        2
      ],
      "liability": -0.290377435,
      "familyId": "invented-pair-02"
    },
    {
      "id": "family-004",
      "dosages": [
        1,
        1,
        1,
        1,
        0,
        2,
        2,
        0,
        1,
        2
      ],
      "liability": -0.162206886,
      "familyId": "invented-pair-02"
    },
    {
      "id": "family-005",
      "dosages": [
        0,
        2,
        1,
        0,
        1,
        1,
        2,
        1,
        0,
        0
      ],
      "liability": -0.607324647,
      "familyId": "invented-pair-03"
    },
    {
      "id": "family-006",
      "dosages": [
        2,
        1,
        1,
        1,
        0,
        1,
        1,
        2,
        0,
        1
      ],
      "liability": 0.082957152,
      "familyId": "invented-pair-03"
    },
    {
      "id": "family-007",
      "dosages": [
        2,
        1,
        2,
        0,
        1,
        2,
        1,
        0,
        1,
        1
      ],
      "liability": 0.85365415,
      "familyId": "invented-pair-04"
    },
    {
      "id": "family-008",
      "dosages": [
        2,
        0,
        1,
        2,
        1,
        0,
        1,
        1,
        2,
        1
      ],
      "liability": 0.255652072,
      "familyId": "invented-pair-04"
    },
    {
      "id": "family-009",
      "dosages": [
        0,
        2,
        0,
        2,
        2,
        0,
        2,
        1,
        2,
        0
      ],
      "liability": -0.787870516,
      "familyId": "invented-pair-05"
    },
    {
      "id": "family-010",
      "dosages": [
        1,
        1,
        2,
        1,
        1,
        2,
        0,
        1,
        2,
        0
      ],
      "liability": 0.682812592,
      "familyId": "invented-pair-05"
    },
    {
      "id": "family-011",
      "dosages": [
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        2
      ],
      "liability": -0.44246718,
      "familyId": "invented-pair-06"
    },
    {
      "id": "family-012",
      "dosages": [
        0,
        0,
        1,
        2,
        1,
        2,
        1,
        2,
        0,
        0
      ],
      "liability": 0.136898502,
      "familyId": "invented-pair-06"
    },
    {
      "id": "family-013",
      "dosages": [
        1,
        2,
        0,
        1,
        2,
        2,
        2,
        1,
        1,
        2
      ],
      "liability": -0.468163542,
      "familyId": "invented-pair-07"
    },
    {
      "id": "family-014",
      "dosages": [
        0,
        1,
        1,
        2,
        2,
        0,
        0,
        1,
        2,
        1
      ],
      "liability": -0.418984637,
      "familyId": "invented-pair-07"
    },
    {
      "id": "family-015",
      "dosages": [
        1,
        0,
        0,
        0,
        0,
        2,
        2,
        0,
        2,
        0
      ],
      "liability": 0.304505167,
      "familyId": "invented-pair-08"
    },
    {
      "id": "family-016",
      "dosages": [
        0,
        1,
        1,
        0,
        0,
        1,
        0,
        1,
        0,
        0
      ],
      "liability": -0.200250682,
      "familyId": "invented-pair-08"
    },
    {
      "id": "family-017",
      "dosages": [
        2,
        2,
        0,
        2,
        2,
        2,
        2,
        1,
        2,
        0
      ],
      "liability": -0.068141791,
      "familyId": "invented-pair-09"
    },
    {
      "id": "family-018",
      "dosages": [
        0,
        1,
        2,
        0,
        0,
        0,
        1,
        2,
        2,
        0
      ],
      "liability": 0.096565614,
      "familyId": "invented-pair-09"
    },
    {
      "id": "family-019",
      "dosages": [
        2,
        2,
        1,
        2,
        2,
        1,
        2,
        2,
        2,
        2
      ],
      "liability": -0.056628931,
      "familyId": "invented-pair-10"
    },
    {
      "id": "family-020",
      "dosages": [
        2,
        0,
        0,
        2,
        1,
        2,
        2,
        0,
        2,
        0
      ],
      "liability": 0.399323596,
      "familyId": "invented-pair-10"
    },
    {
      "id": "family-021",
      "dosages": [
        1,
        1,
        0,
        2,
        0,
        1,
        2,
        0,
        1,
        1
      ],
      "liability": -0.645288195,
      "familyId": "invented-pair-11"
    },
    {
      "id": "family-022",
      "dosages": [
        0,
        1,
        0,
        0,
        1,
        1,
        2,
        1,
        2,
        0
      ],
      "liability": -0.179461005,
      "familyId": "invented-pair-11"
    },
    {
      "id": "family-023",
      "dosages": [
        1,
        1,
        1,
        1,
        2,
        2,
        1,
        2,
        2,
        2
      ],
      "liability": 0.276447555,
      "familyId": "invented-pair-12"
    },
    {
      "id": "family-024",
      "dosages": [
        0,
        1,
        1,
        1,
        1,
        2,
        2,
        0,
        2,
        1
      ],
      "liability": -0.146522466,
      "familyId": "invented-pair-12"
    },
    {
      "id": "family-025",
      "dosages": [
        2,
        0,
        1,
        2,
        2,
        0,
        1,
        0,
        2,
        2
      ],
      "liability": 0.393372388,
      "familyId": "invented-pair-13"
    },
    {
      "id": "family-026",
      "dosages": [
        1,
        0,
        0,
        0,
        1,
        2,
        2,
        1,
        0,
        2
      ],
      "liability": 0.153991928,
      "familyId": "invented-pair-13"
    },
    {
      "id": "family-027",
      "dosages": [
        0,
        2,
        1,
        1,
        2,
        0,
        1,
        2,
        1,
        2
      ],
      "liability": -0.552701706,
      "familyId": "invented-pair-14"
    },
    {
      "id": "family-028",
      "dosages": [
        2,
        0,
        1,
        1,
        0,
        2,
        2,
        1,
        0,
        2
      ],
      "liability": 0.366217536,
      "familyId": "invented-pair-14"
    },
    {
      "id": "family-029",
      "dosages": [
        2,
        1,
        2,
        0,
        1,
        2,
        1,
        0,
        1,
        2
      ],
      "liability": 0.45091672,
      "familyId": "invented-pair-15"
    },
    {
      "id": "family-030",
      "dosages": [
        2,
        1,
        1,
        1,
        0,
        2,
        2,
        2,
        2,
        0
      ],
      "liability": 0.252820009,
      "familyId": "invented-pair-15"
    },
    {
      "id": "family-031",
      "dosages": [
        0,
        2,
        2,
        0,
        0,
        1,
        0,
        0,
        2,
        0
      ],
      "liability": -0.283021281,
      "familyId": "invented-pair-16"
    },
    {
      "id": "family-032",
      "dosages": [
        2,
        0,
        0,
        0,
        2,
        2,
        0,
        0,
        0,
        1
      ],
      "liability": 0.882441427,
      "familyId": "invented-pair-16"
    }
  ],
  "calibration": [
    {
      "id": "calibration-001",
      "event": false
    },
    {
      "id": "calibration-002",
      "event": true
    },
    {
      "id": "calibration-003",
      "event": false
    },
    {
      "id": "calibration-004",
      "event": false
    },
    {
      "id": "calibration-005",
      "event": false
    },
    {
      "id": "calibration-006",
      "event": true
    },
    {
      "id": "calibration-007",
      "event": true
    },
    {
      "id": "calibration-008",
      "event": false
    },
    {
      "id": "calibration-009",
      "event": false
    },
    {
      "id": "calibration-010",
      "event": false
    },
    {
      "id": "calibration-011",
      "event": false
    },
    {
      "id": "calibration-012",
      "event": false
    },
    {
      "id": "calibration-013",
      "event": false
    },
    {
      "id": "calibration-014",
      "event": false
    },
    {
      "id": "calibration-015",
      "event": false
    },
    {
      "id": "calibration-016",
      "event": false
    },
    {
      "id": "calibration-017",
      "event": true
    },
    {
      "id": "calibration-018",
      "event": false
    },
    {
      "id": "calibration-019",
      "event": true
    },
    {
      "id": "calibration-020",
      "event": false
    },
    {
      "id": "calibration-021",
      "event": false
    },
    {
      "id": "calibration-022",
      "event": false
    },
    {
      "id": "calibration-023",
      "event": false
    },
    {
      "id": "calibration-024",
      "event": false
    },
    {
      "id": "calibration-025",
      "event": false
    },
    {
      "id": "calibration-026",
      "event": false
    },
    {
      "id": "calibration-027",
      "event": false
    },
    {
      "id": "calibration-028",
      "event": false
    },
    {
      "id": "calibration-029",
      "event": false
    },
    {
      "id": "calibration-030",
      "event": false
    },
    {
      "id": "calibration-031",
      "event": true
    },
    {
      "id": "calibration-032",
      "event": false
    },
    {
      "id": "calibration-033",
      "event": false
    },
    {
      "id": "calibration-034",
      "event": false
    },
    {
      "id": "calibration-035",
      "event": false
    },
    {
      "id": "calibration-036",
      "event": false
    },
    {
      "id": "calibration-037",
      "event": true
    },
    {
      "id": "calibration-038",
      "event": false
    },
    {
      "id": "calibration-039",
      "event": false
    },
    {
      "id": "calibration-040",
      "event": false
    },
    {
      "id": "calibration-041",
      "event": true
    },
    {
      "id": "calibration-042",
      "event": false
    },
    {
      "id": "calibration-043",
      "event": true
    },
    {
      "id": "calibration-044",
      "event": false
    },
    {
      "id": "calibration-045",
      "event": true
    },
    {
      "id": "calibration-046",
      "event": false
    },
    {
      "id": "calibration-047",
      "event": false
    },
    {
      "id": "calibration-048",
      "event": true
    },
    {
      "id": "calibration-049",
      "event": false
    },
    {
      "id": "calibration-050",
      "event": false
    },
    {
      "id": "calibration-051",
      "event": false
    },
    {
      "id": "calibration-052",
      "event": false
    },
    {
      "id": "calibration-053",
      "event": false
    },
    {
      "id": "calibration-054",
      "event": true
    },
    {
      "id": "calibration-055",
      "event": false
    },
    {
      "id": "calibration-056",
      "event": false
    },
    {
      "id": "calibration-057",
      "event": false
    },
    {
      "id": "calibration-058",
      "event": false
    },
    {
      "id": "calibration-059",
      "event": false
    },
    {
      "id": "calibration-060",
      "event": false
    },
    {
      "id": "calibration-061",
      "event": false
    },
    {
      "id": "calibration-062",
      "event": false
    },
    {
      "id": "calibration-063",
      "event": false
    },
    {
      "id": "calibration-064",
      "event": false
    },
    {
      "id": "calibration-065",
      "event": false
    },
    {
      "id": "calibration-066",
      "event": false
    },
    {
      "id": "calibration-067",
      "event": false
    },
    {
      "id": "calibration-068",
      "event": false
    },
    {
      "id": "calibration-069",
      "event": false
    },
    {
      "id": "calibration-070",
      "event": false
    },
    {
      "id": "calibration-071",
      "event": false
    },
    {
      "id": "calibration-072",
      "event": false
    },
    {
      "id": "calibration-073",
      "event": false
    },
    {
      "id": "calibration-074",
      "event": false
    },
    {
      "id": "calibration-075",
      "event": false
    },
    {
      "id": "calibration-076",
      "event": false
    },
    {
      "id": "calibration-077",
      "event": false
    },
    {
      "id": "calibration-078",
      "event": true
    },
    {
      "id": "calibration-079",
      "event": false
    },
    {
      "id": "calibration-080",
      "event": true
    },
    {
      "id": "calibration-081",
      "event": false
    },
    {
      "id": "calibration-082",
      "event": false
    },
    {
      "id": "calibration-083",
      "event": false
    },
    {
      "id": "calibration-084",
      "event": true
    },
    {
      "id": "calibration-085",
      "event": false
    },
    {
      "id": "calibration-086",
      "event": false
    },
    {
      "id": "calibration-087",
      "event": false
    },
    {
      "id": "calibration-088",
      "event": false
    },
    {
      "id": "calibration-089",
      "event": false
    },
    {
      "id": "calibration-090",
      "event": false
    },
    {
      "id": "calibration-091",
      "event": false
    },
    {
      "id": "calibration-092",
      "event": true
    },
    {
      "id": "calibration-093",
      "event": false
    },
    {
      "id": "calibration-094",
      "event": false
    },
    {
      "id": "calibration-095",
      "event": false
    },
    {
      "id": "calibration-096",
      "event": true
    },
    {
      "id": "calibration-097",
      "event": true
    },
    {
      "id": "calibration-098",
      "event": false
    },
    {
      "id": "calibration-099",
      "event": false
    },
    {
      "id": "calibration-100",
      "event": false
    },
    {
      "id": "calibration-101",
      "event": false
    },
    {
      "id": "calibration-102",
      "event": false
    },
    {
      "id": "calibration-103",
      "event": true
    },
    {
      "id": "calibration-104",
      "event": false
    },
    {
      "id": "calibration-105",
      "event": false
    },
    {
      "id": "calibration-106",
      "event": false
    },
    {
      "id": "calibration-107",
      "event": false
    },
    {
      "id": "calibration-108",
      "event": false
    },
    {
      "id": "calibration-109",
      "event": false
    },
    {
      "id": "calibration-110",
      "event": false
    },
    {
      "id": "calibration-111",
      "event": false
    },
    {
      "id": "calibration-112",
      "event": true
    },
    {
      "id": "calibration-113",
      "event": false
    },
    {
      "id": "calibration-114",
      "event": false
    },
    {
      "id": "calibration-115",
      "event": true
    },
    {
      "id": "calibration-116",
      "event": true
    },
    {
      "id": "calibration-117",
      "event": false
    },
    {
      "id": "calibration-118",
      "event": false
    },
    {
      "id": "calibration-119",
      "event": false
    },
    {
      "id": "calibration-120",
      "event": true
    },
    {
      "id": "calibration-121",
      "event": false
    },
    {
      "id": "calibration-122",
      "event": false
    },
    {
      "id": "calibration-123",
      "event": false
    },
    {
      "id": "calibration-124",
      "event": false
    },
    {
      "id": "calibration-125",
      "event": true
    },
    {
      "id": "calibration-126",
      "event": false
    },
    {
      "id": "calibration-127",
      "event": false
    },
    {
      "id": "calibration-128",
      "event": false
    },
    {
      "id": "calibration-129",
      "event": false
    },
    {
      "id": "calibration-130",
      "event": false
    },
    {
      "id": "calibration-131",
      "event": false
    },
    {
      "id": "calibration-132",
      "event": false
    },
    {
      "id": "calibration-133",
      "event": false
    },
    {
      "id": "calibration-134",
      "event": false
    },
    {
      "id": "calibration-135",
      "event": true
    },
    {
      "id": "calibration-136",
      "event": false
    },
    {
      "id": "calibration-137",
      "event": false
    },
    {
      "id": "calibration-138",
      "event": false
    },
    {
      "id": "calibration-139",
      "event": false
    },
    {
      "id": "calibration-140",
      "event": false
    },
    {
      "id": "calibration-141",
      "event": true
    },
    {
      "id": "calibration-142",
      "event": true
    },
    {
      "id": "calibration-143",
      "event": false
    },
    {
      "id": "calibration-144",
      "event": false
    },
    {
      "id": "calibration-145",
      "event": false
    },
    {
      "id": "calibration-146",
      "event": false
    },
    {
      "id": "calibration-147",
      "event": false
    },
    {
      "id": "calibration-148",
      "event": false
    },
    {
      "id": "calibration-149",
      "event": false
    },
    {
      "id": "calibration-150",
      "event": true
    },
    {
      "id": "calibration-151",
      "event": false
    },
    {
      "id": "calibration-152",
      "event": true
    },
    {
      "id": "calibration-153",
      "event": false
    },
    {
      "id": "calibration-154",
      "event": false
    },
    {
      "id": "calibration-155",
      "event": false
    },
    {
      "id": "calibration-156",
      "event": false
    },
    {
      "id": "calibration-157",
      "event": false
    },
    {
      "id": "calibration-158",
      "event": false
    },
    {
      "id": "calibration-159",
      "event": false
    },
    {
      "id": "calibration-160",
      "event": false
    },
    {
      "id": "calibration-161",
      "event": false
    },
    {
      "id": "calibration-162",
      "event": false
    },
    {
      "id": "calibration-163",
      "event": false
    },
    {
      "id": "calibration-164",
      "event": false
    },
    {
      "id": "calibration-165",
      "event": false
    },
    {
      "id": "calibration-166",
      "event": false
    },
    {
      "id": "calibration-167",
      "event": false
    },
    {
      "id": "calibration-168",
      "event": false
    },
    {
      "id": "calibration-169",
      "event": false
    },
    {
      "id": "calibration-170",
      "event": false
    },
    {
      "id": "calibration-171",
      "event": false
    },
    {
      "id": "calibration-172",
      "event": false
    },
    {
      "id": "calibration-173",
      "event": false
    },
    {
      "id": "calibration-174",
      "event": false
    },
    {
      "id": "calibration-175",
      "event": false
    },
    {
      "id": "calibration-176",
      "event": false
    },
    {
      "id": "calibration-177",
      "event": false
    },
    {
      "id": "calibration-178",
      "event": true
    },
    {
      "id": "calibration-179",
      "event": false
    },
    {
      "id": "calibration-180",
      "event": false
    },
    {
      "id": "calibration-181",
      "event": false
    },
    {
      "id": "calibration-182",
      "event": false
    },
    {
      "id": "calibration-183",
      "event": false
    },
    {
      "id": "calibration-184",
      "event": false
    },
    {
      "id": "calibration-185",
      "event": false
    },
    {
      "id": "calibration-186",
      "event": false
    },
    {
      "id": "calibration-187",
      "event": false
    },
    {
      "id": "calibration-188",
      "event": false
    },
    {
      "id": "calibration-189",
      "event": false
    },
    {
      "id": "calibration-190",
      "event": false
    },
    {
      "id": "calibration-191",
      "event": true
    },
    {
      "id": "calibration-192",
      "event": false
    },
    {
      "id": "calibration-193",
      "event": false
    },
    {
      "id": "calibration-194",
      "event": true
    },
    {
      "id": "calibration-195",
      "event": false
    },
    {
      "id": "calibration-196",
      "event": false
    },
    {
      "id": "calibration-197",
      "event": false
    },
    {
      "id": "calibration-198",
      "event": false
    },
    {
      "id": "calibration-199",
      "event": false
    },
    {
      "id": "calibration-200",
      "event": true
    }
  ]
}
$fixed_artifact$::jsonb;
$artifact$;

create function private.current_embryo_test_fit_admission_v1() returns jsonb
language plpgsql security definer set search_path='' as $fit_admission$
declare base jsonb:=private.current_embryo_test_statistical_admission_v1(); a jsonb; p jsonb;
begin
 if base is null then return null;end if;
 select to_jsonb(row) into a from private.embryo_test_statistical_admission row where singleton for share;
 if a->'fit_artifact_sha256'='null'::jsonb then return null;end if;
 p:=private.embryo_test_fit_package_v1(private.embryo_test_fit_artifact_v1());
 if a->>'fit_artifact_sha256' is distinct from '5355327cfe90cda24ca2d27cd3afab2e53d26b5d6995b69cb296d3b975c6d408'
  or a->'fit_artifact' is distinct from private.embryo_test_fit_artifact_v1()
  or a->'fit_package' is distinct from p
  or a->>'fit_package_digest' is distinct from private.embryo_test_fit_package_digest_v1(p) then
  raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end if;
 return a;
end $fit_admission$;

-- Original full admission, grant, source, publication and QC capture runs
-- first. No fitting door substitutes a fixture grant or caller source subset.
create function private.capture_embryo_test_statistical_fit_v1(p_cohort uuid,p_test boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $fit_capture$
declare admission jsonb; a jsonb;
begin
 if p_test is distinct from true then raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end if;
 admission:=private.current_embryo_test_fit_admission_v1();if admission is null then return null;end if;
 a:=private.capture_embryo_test_statistical_v1(p_cohort,p_test);if a is null then return null;end if;
 a:=jsonb_set(a,'{conditions,0,reference_receipt}',admission);
 return a||jsonb_build_object('version','embryo-test-statistical-fit-capture-v1',
  'fitArtifact',admission->'fit_artifact','fitPackage',admission->'fit_package','fitPackageDigest',admission->'fit_package_digest');
end $fit_capture$;

-- Pure own-call evaluation: complete matcher supplies doses/refusals first.
-- This grants no admission/publication authority. Save supplies actual calls.
create function private.evaluate_embryo_test_fit_v1(p_source jsonb,p_calls jsonb,p_qc jsonb) returns jsonb
language plpgsql immutable set search_path='' as $evaluate$
declare m jsonb; p jsonb:=private.embryo_test_fit_package_raw_v1(private.embryo_test_fit_artifact_v1());
 policy jsonb:=private.embryo_carrier_qc_policy_v1(); panel jsonb:=private.embryo_test_statistical_panel_v1();
 x double precision[]:='{}'; weights double precision[]:='{}'; missing_weights double precision[]:='{}'; contrast double precision;
 model_accuracy double precision;reference_sampling double precision;baseline_sampling double precision;missing_coverage double precision;
 scale double precision;performance_se double precision;total double precision;multiplier double precision; center double precision;half double precision;
 z double precision:=1.959963984540054; i integer; dose integer; allele text; call jsonb; value double precision;
begin
 if jsonb_typeof(p_qc) is distinct from 'object' then return '{"ok":false,"reason":"invalid_qc"}'::jsonb;end if;
 if (select array_agg(k order by k) from jsonb_object_keys(p_qc) k)
  is distinct from array['alleleDropout','callRate','contamination']
  or exists(select 1 from unnest(array['callRate','contamination','alleleDropout']) k where
   (case when jsonb_typeof(p_qc->k)='number' then (p_qc->>k)::double precision between 0 and 1
     when k<>'callRate' and p_qc->k='null'::jsonb then true else false end) is not true) then
  return '{"ok":false,"reason":"invalid_qc"}'::jsonb;end if;
 if (p_qc->>'callRate')::double precision<(policy->>'callRateNoFigure')::double precision
  or (p_qc->>'contamination')::double precision>(policy->>'contaminationCeiling')::double precision
  or (p_qc->>'alleleDropout')::double precision>(policy->>'dropoutCeiling')::double precision then
  return '{"ok":false,"reason":"qc_not_reportable"}'::jsonb;end if;
 m:=private.measure_embryo_test_statistical_v1(p_source,p_calls);
 if m->'ok' is distinct from 'true'::jsonb then return m;end if;
 if (m#>>'{measurement,scoreCoverage}')::double precision<(policy->>'scoreCoverageFloor')::double precision then
  return '{"ok":false,"reason":"below_coverage_floor"}'::jsonb;end if;
 if (p#>>'{holdout,r2}')::double precision<=0 or (p#>>'{holdout,interval,0}')::double precision<=0
  or (p#>>'{holdout,interval,1}')::double precision>=1 then
  return '{"ok":false,"reason":"synthetic_performance_unavailable"}'::jsonb;end if;
 for i in 0..9 loop
  weights:=array_append(weights,(p#>>array['fit','coefficients',(i+1)::text])::double precision);
  if m#>>array['measurement','rows',i::text,'state']='matched' then
   select row into call from jsonb_array_elements(p_calls) row
    where row->'chrom'=panel#>array['variants',i::text,'chrom'] and row->'pos'=panel#>array['variants',i::text,'pos'] limit 1;
   dose:=0;foreach allele in array string_to_array(call->>'genotype','/') loop
    if allele=panel#>>array['variants',i::text,'effectAllele'] then dose:=dose+1;end if;end loop;
   x:=array_append(x,dose-(p#>>array['reference','centers',i::text])::double precision);
   missing_weights:=array_append(missing_weights,0);
  else x:=array_append(x,0);missing_weights:=array_append(missing_weights,weights[i+1]);end if;
 end loop;
 contrast:=private.embryo_test_fit_dot_v1(x,weights);scale:=sqrt((p#>>'{holdout,r2}')::double precision);
 performance_se:=(sqrt((p#>>'{holdout,interval,1}')::double precision)-sqrt((p#>>'{holdout,interval,0}')::double precision))/(2*z);
 model_accuracy:=private.embryo_test_fit_quadratic_v1(array_prepend(0::double precision,x),p#>'{fit,covariance}')*scale^2+contrast^2*performance_se^2;
 reference_sampling:=private.embryo_test_fit_quadratic_v1(weights,p#>'{reference,covariance}')*scale^2/96;
 value:=(p#>>'{baseline,interval,1}')::double precision;
 baseline_sampling:=ln(value/(1-value));value:=(p#>>'{baseline,interval,0}')::double precision;
 baseline_sampling:=((baseline_sampling-ln(value/(1-value)))/(2*z))^2;
 missing_coverage:=private.embryo_test_fit_quadratic_v1(missing_weights,p#>'{reference,covariance}')*scale^2;
 total:=model_accuracy+reference_sampling+baseline_sampling+missing_coverage;
 if total<=0 then raise exception using errcode='22023',message='synthetic_fit_covariance_refused';end if;
 multiplier:=case when p_qc->'alleleDropout'='null'::jsonb then (policy->>'dropoutUnmeasuredWidening')::double precision else 1 end;
 value:=(p#>>'{baseline,point}')::double precision;center:=ln(value/(1-value))+scale*contrast;
 half:=z*sqrt(total)*multiplier;
 return jsonb_build_object('ok',true,'result',jsonb_build_object('version',1,'kind','synthetic-test-probability',
  'figureBasis','{"version":1,"basis":"modelled"}'::jsonb,'coverageBasis','{"version":1,"basis":"observed"}'::jsonb,
  'point',private.embryo_test_fit_decimal_v1(1/(1+exp(-center))),
  'interval',jsonb_build_array(private.embryo_test_fit_decimal_v1(1/(1+exp(-(center-half)))),private.embryo_test_fit_decimal_v1(1/(1+exp(-(center+half))))),
  'varianceComponents',jsonb_build_object('modelAccuracy',private.embryo_test_fit_decimal_v1(model_accuracy),
   'referenceSampling',private.embryo_test_fit_decimal_v1(reference_sampling),'baselineSampling',private.embryo_test_fit_decimal_v1(baseline_sampling),
   'missingCoverage',private.embryo_test_fit_decimal_v1(missing_coverage)),
  'totalVariance',private.embryo_test_fit_decimal_v1(total),'dropoutMultiplier',private.embryo_test_fit_decimal_v1(multiplier),
  'logPoint',private.embryo_test_fit_decimal_v1(center),'logBounds',jsonb_build_array(private.embryo_test_fit_decimal_v1(center-half),private.embryo_test_fit_decimal_v1(center+half)),
  'withinFamily',p->'withinFamily','clinicalPublication',false));
end $evaluate$;

create function private.expected_embryo_test_fit_measurement_v1(p_embryo jsonb,p_condition jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fit_expected$
declare expected jsonb:=private.expected_embryo_test_statistical_measurement_v1(p_embryo,p_condition); result jsonb;
begin
 if expected->>'reason'='sex_combined_model_unavailable' then
  result:=private.evaluate_embryo_test_fit_v1(p_embryo->'source',private.embryo_test_statistical_calls_v1(p_embryo),
   jsonb_build_object('callRate',p_embryo#>'{qc,call_rate}','contamination',p_embryo#>'{qc,contamination_estimate}',
    'alleleDropout',p_embryo#>'{qc,allelic_dropout_estimate}));
  if result->'ok' is distinct from 'true'::jsonb then raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end if;
 end if;
 return expected||jsonb_build_object('result',result->'result');
end $fit_expected$;

-- Preserve the original coverage-only admission projection and all its guards.
do $compat$ declare p pg_catalog.pg_proc;begin
 select * into p from pg_catalog.pg_proc where oid=to_regprocedure('private.current_embryo_test_statistical_admission_v1()');
 if p.oid is null or md5(p.prosrc) is distinct from '8499c23a3b16fae75e8275d5d1b13468'
  or p.proowner is distinct from 'postgres'::regrole or p.prosecdef is distinct from true
  or p.prokind is distinct from 'f' or p.pronargs is distinct from 0 or p.prorettype is distinct from 'jsonb'::regtype
  or p.proconfig is distinct from array['search_path=""'] then
  raise exception using errcode='55000',message='synthetic_fit_predecessor_changed';end if;
end $compat$;
create or replace function private.current_embryo_test_statistical_admission_v1() returns jsonb
language plpgsql security definer set search_path='' as $admission$
declare a private.embryo_test_statistical_admission; system_id text;
begin
 select * into a from private.embryo_test_statistical_admission where singleton for share;
 -- Default absence refuses before cohort/genomic lookup, including prod/preview.
 if a.singleton is null then return null;end if;
 select system_identifier::text into system_id from pg_catalog.pg_control_system();
 if (a.version<>1 or a.panel_sha256<>'c08fcfea75896e134cfc68ac844bedc0f5aa3b7a4b5623d97806297978df984f'
  or a.panel is distinct from private.embryo_test_statistical_panel_v1()
  or a.system_identifier is distinct from system_id or a.database_name is distinct from current_database()
  or a.database_oid is distinct from (select oid from pg_catalog.pg_database where datname=current_database())
  or a.server_version is distinct from current_setting('server_version_num')::integer
  or jsonb_typeof(a.runtime_binding) is distinct from 'object'
  or (select array_agg(k order by k) from jsonb_object_keys(a.runtime_binding) k) is distinct from
    array['configSha256','daemonId','dbContainerId','head','kind','migrationSha256','networkId','owner','project','runtimeIdentity']
  or a.runtime_binding->>'kind' not in('owned-linux','github-browser')
  or a.runtime_binding->>'project' is distinct from 'sequence'
  or a.runtime_binding->>'head'!~'^[0-9a-f]{40}$'
  or a.runtime_binding->>'migrationSha256'!~'^[0-9a-f]{64}$'
  or a.runtime_binding->>'configSha256'!~'^[0-9a-f]{64}$'
  or a.runtime_binding->>'dbContainerId'!~'^[0-9a-f]{64}$'
  or a.runtime_binding->>'networkId'!~'^[0-9a-f]{64}$'
  or a.runtime_binding->>'owner'!~'^[0-9a-f-]{36}$'
  or jsonb_typeof(a.runtime_binding->'runtimeIdentity') is distinct from 'object'
  or nullif(a.runtime_binding->>'daemonId','') is null) is not false then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 return to_jsonb(a)-array['fit_artifact_sha256','fit_artifact','fit_package','fit_package_digest'];
end $admission$;
revoke all on function private.current_embryo_test_statistical_admission_v1() from public,anon,authenticated,inherit_upload_only,service_role;

-- Original complete native boundary, with a distinct fitted revision/receipt.
create function public.enqueue_embryo_test_statistical_fit_v1(p_cohort_id uuid,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms' as $enqueue$
declare a jsonb; j public.worker_jobs; v_hash text;
begin
 a:=private.capture_embryo_test_statistical_fit_v1(p_cohort_id,p_test_jurisdiction);
 if a is null then return '{"status":"held","reason":"synthetic_reference_unavailable"}'::jsonb; end if;
 v_hash:=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex');
 j:=private.enqueue_worker_job_v2((a#>>'{authority,cohort,owner_account_id}')::uuid,
  'score_embryo','embryo.statistical-estimate',null,p_cohort_id,'cohort-source-set',p_cohort_id,
  (a->>'publicationRevision')::bigint,v_hash,'embryo-test-statistical-fit-v1',null,
  jsonb_build_object('capture',a));
 if j.payload is distinct from jsonb_build_object('capture',a) then
  raise exception using errcode='23505',message='embryo_test_statistical_binding_collision'; end if;
 return jsonb_build_object('status','queued','jobId',j.id);
end $enqueue$;
revoke all on function public.enqueue_embryo_test_statistical_fit_v1(uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.enqueue_embryo_test_statistical_fit_v1(uuid,boolean) to service_role;

-- Original complete native boundary, with a distinct fitted revision/receipt.
create function private.embryo_test_fit_receipt_v1(p_job public.worker_jobs,p_embryo jsonb,
 p_condition jsonb,p_measurement jsonb) returns jsonb language sql immutable set search_path='' as $saved_receipt$
 select jsonb_build_object('version',1,'producer','embryo-test-statistical-fit-v1',
  'job_id',(p_job).id,'attempt',(p_job).attempts,'capture_sha256',(p_job).file_sha256,
  'condition_id','SYNTHETIC:9001','source',p_embryo->'source','reference_receipt',p_condition->'reference_receipt',
  'measurement',p_measurement,'clinicalPublication',false,
  'fitPackage',p_condition#>'{reference_receipt,fit_package}','fitPackageDigest',p_condition#>'{reference_receipt,fit_package_digest}','publication','synthetic-fitted-test-only','interpretation','held');
$saved_receipt$;
revoke all on function private.embryo_test_fit_receipt_v1(public.worker_jobs,jsonb,jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;

-- Original complete native boundary, with a distinct fitted revision/receipt.
create function private.valid_embryo_test_fit_receipt_v1(p_receipt jsonb) returns boolean
language sql immutable set search_path='' as $receipt$
 select coalesce(jsonb_typeof(p_receipt)='object'
  and (select array_agg(k order by k) from jsonb_object_keys(p_receipt) k)=
   array['attempt','capture_sha256','clinicalPublication','condition_id','fitPackage','fitPackageDigest','interpretation','job_id','measurement','producer','publication','reference_receipt','source','version']
  and p_receipt->'clinicalPublication'='false'::jsonb
  and jsonb_typeof(p_receipt->'fitPackage')='object' and p_receipt->>'fitPackageDigest'~'^[0-9a-f]{64}$'
  and p_receipt->'version'='1'::jsonb and p_receipt->>'producer'='embryo-test-statistical-fit-v1'
  and p_receipt->>'condition_id'='SYNTHETIC:9001' and p_receipt->>'publication'='synthetic-fitted-test-only'
  and p_receipt->>'interpretation'='held' and p_receipt->>'capture_sha256'~'^[0-9a-f]{64}$'
  and p_receipt->>'job_id'~'^[0-9a-f-]{36}$' and p_receipt->>'attempt'~'^([1-9]|1[0-9]|20)$'
  and jsonb_typeof(p_receipt->'source') in('object','null')
  and jsonb_typeof(p_receipt->'reference_receipt')='object'
  and jsonb_typeof(p_receipt->'measurement')='object',false);
$receipt$;
revoke all on function private.valid_embryo_test_fit_receipt_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.valid_embryo_test_fit_receipt_v1(jsonb) to service_role;

-- Original complete native boundary, with a distinct fitted revision/receipt.
create function private.guard_embryo_test_fit_score_v1(p_score public.embryo_scores) returns void
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $score_guard$
declare j public.worker_jobs; a jsonb; e jsonb; c jsonb; expected jsonb;
begin
 if not private.valid_embryo_test_fit_receipt_v1(p_score.computation_receipt) then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 select * into j from public.worker_jobs where id=(p_score.computation_receipt->>'job_id')::uuid;
 if j.id is null or j.kind<>'score_embryo' or j.output_kind<>'embryo.statistical-estimate'
  or j.computation_revision<>'embryo-test-statistical-fit-v1' or j.status<>'running'
  or j.claim_expires_at<=clock_timestamp() or j.attempts<>(p_score.computation_receipt->>'attempt')::integer then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 a:=private.capture_embryo_test_statistical_fit_v1(j.cohort_id,true);
 if a is null or j.payload is distinct from jsonb_build_object('capture',a)
  or j.file_sha256 is distinct from encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex')
  or j.file_sha256 is distinct from p_score.computation_receipt->>'capture_sha256'
  or j.source_binding_kind is distinct from 'cohort-source-set' or j.source_binding_id is distinct from j.cohort_id
  or j.source_binding_revision is distinct from (a->>'publicationRevision')::bigint
  or j.user_id is distinct from (a#>>'{authority,cohort,owner_account_id}')::uuid
  or j.subject_id is not null or j.file_id is not null then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 select value into e from jsonb_array_elements(a->'embryos') where (value->>'embryoId')::uuid=p_score.embryo_id;
 select value into c from jsonb_array_elements(a->'conditions') where value->>'condition_id'=p_score.condition_id;
 if e is null or c is null then raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 expected:=private.expected_embryo_test_fit_measurement_v1(e,c);
 if p_score.computation_receipt is distinct from private.embryo_test_fit_receipt_v1(j,e,c,expected)
  or p_score.finding is distinct from nullif(expected->'finding','null'::jsonb)
  or p_score.condition_name is distinct from 'Synthetic score coverage'
  or p_score.not_covered_reason is distinct from expected->>'reason'
  or p_score.coverage_state is distinct from private.embryo_test_statistical_coverage_v1(expected)
  or p_score.source_binding_fingerprint is distinct from j.file_sha256
  or p_score.model_id is not null or p_score.model_version is not null
  or p_score.evidence_label is distinct from 'preliminary' or p_score.citation_ids is distinct from '{}'::text[] then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
end $score_guard$;
revoke all on function private.guard_embryo_test_fit_score_v1(public.embryo_scores) from public,anon,authenticated,inherit_upload_only,service_role;

-- Original complete native boundary, with a distinct fitted revision/receipt.
create function public.embryo_test_statistical_fit_worker_v1(p_operation text,p_job_id uuid,p_attempt integer,
 p_claim_token_hash text,p_payload jsonb,p_test_jurisdiction boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
set extra_float_digits=3 as $worker$
declare j public.worker_jobs; a jsonb; v_hash text; e jsonb; c jsonb; m jsonb; expected jsonb;
 v_deadline timestamptz; v_revision bigint; v_saved integer:=0; v_measurements jsonb:='[]';
 v_after uuid; v_next uuid; v_cohort uuid; v_checked integer:=0; v_queued integer:=0;
 v_assertion jsonb; v_pages jsonb:='[]'; v_assertion_id jsonb;
begin
 if p_test_jurisdiction is distinct from true or p_claim_token_hash is null
  or p_claim_token_hash!~'^[0-9a-f]{64}$' or p_operation is null
  or p_operation not in('reconcile','claim','check','read','save','fail')
  or not exists(select 1 from private.embryo_split_config where enabled) then
  raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 if private.current_embryo_test_fit_admission_v1() is null then
  return '{"status":"held","reason":"synthetic_reference_unavailable"}'::jsonb;end if;
 if p_operation='reconcile' then
  if p_job_id is not null or p_attempt is not null or jsonb_typeof(p_payload) is distinct from 'object'
   or (select array_agg(k order by k) from jsonb_object_keys(p_payload) k) is distinct from array['afterCohortId']
   or (p_payload->'afterCohortId'<>'null'::jsonb and (jsonb_typeof(p_payload->'afterCohortId')<>'string'
    or p_payload->>'afterCohortId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
   raise exception using errcode='22023',message='invalid_request';end if;
  -- Recover a lost postcommit enqueue from durable current source/consent
  -- records. Empty admission never enumerates cohorts. Every candidate goes
  -- through the same current full capture and idempotent enqueue; the cursor
  -- selects only a bounded inventory page, never authority or source bytes.
  if private.current_embryo_test_fit_admission_v1() is null then
   return '{"status":"held","reason":"synthetic_reference_unavailable"}'::jsonb;end if;
  v_after:=(p_payload->>'afterCohortId')::uuid;
  for v_cohort in select id from public.embryo_cohorts where status='active'
   and publication_revision is not null and owner_account_id is not null and uploaded_at is not null
   and retention_expires_at>clock_timestamp() and (v_after is null or id>v_after) order by id limit 4 loop
   v_checked:=v_checked+1;v_next:=v_cohort;
   begin
    a:=public.enqueue_embryo_test_statistical_fit_v1(v_cohort,true);
    if a->>'status'='queued' then v_queued:=v_queued+1;end if;
   exception when insufficient_privilege then
    -- Missing/revoked current authority admits no job; a later complete pass
    -- resolves current state again. Other failures abort the bounded page.
    null;
   end;
  end loop;
  return jsonb_build_object('version','embryo-test-statistical-fit-reconcile-v1','checked',v_checked,'queued',v_queued,
   'nextCursor',case when v_checked=4 then v_next else null end);
 end if;
 if p_operation='claim' then
  if p_job_id is not null or p_attempt is not null or p_payload is not null then
   raise exception using errcode='22023',message='invalid_request';end if;
  select * into j from public.worker_jobs where kind='score_embryo' and output_kind='embryo.statistical-estimate'
   and computation_revision='embryo-test-statistical-fit-v1'
   and (status='queued' or (status='running' and claim_expires_at<=clock_timestamp()))
   and not_before<=clock_timestamp() order by created_at,id limit 1;
  if j.id is null then return null;end if;
 else
  select * into j from public.worker_jobs where id=p_job_id;
  if j.id is null or j.status<>'running' or j.kind<>'score_embryo' or j.output_kind<>'embryo.statistical-estimate'
   or j.computation_revision<>'embryo-test-statistical-fit-v1'
   or j.attempts is distinct from p_attempt or j.claim_token_hash is distinct from p_claim_token_hash
   or j.claim_expires_at<=clock_timestamp() then
   raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 end if;
 begin
  a:=private.capture_embryo_test_statistical_fit_v1(j.cohort_id,true);
 exception when insufficient_privilege then a:=null;
 end;
 -- The capture acquired all subject/authority locks before this job lock.
 select * into j from public.worker_jobs where id=j.id for update skip locked;
 if j.id is null then return null;end if;
 v_hash:=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex');
 if a is null or j.payload is distinct from jsonb_build_object('capture',a)
  or j.file_sha256 is distinct from v_hash or j.source_binding_kind is distinct from 'cohort-source-set'
  or j.source_binding_id is distinct from j.cohort_id or j.source_binding_revision is distinct from (a->>'publicationRevision')::bigint
  or j.subject_id is not null or j.file_id is not null or j.user_id is distinct from (a#>>'{authority,cohort,owner_account_id}')::uuid then
  update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null where id=j.id and status in('queued','running');
  return '{"status":"cancelled"}'::jsonb;
 end if;
 v_deadline:=least((a#>>'{authority,expiresAt}')::timestamptz,j.created_at+interval '24 hours');
 if v_deadline<=clock_timestamp() then
  update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null where id=j.id;
  return '{"status":"cancelled"}'::jsonb;end if;
 if p_operation='claim' then
  if j.status<>'queued' and not(j.status='running' and j.claim_expires_at<=clock_timestamp()) then return null;end if;
  if j.attempts>=j.max_attempts then
   update public.worker_jobs set status='cancelled',finished_at=clock_timestamp(),claim_token_hash=null,
    claim_expires_at=null,claimed_by=null where id=j.id;
   return '{"status":"cancelled"}'::jsonb;end if;
  update public.worker_jobs set status='running',attempts=attempts+1,claim_token_hash=p_claim_token_hash,
   claim_expires_at=least(clock_timestamp()+interval '5 minutes',v_deadline),claimed_by='embryo-test-statistical-worker',
   started_at=coalesce(started_at,clock_timestamp()),progress_note='scoring'
   where id=j.id returning * into j;
 else
  if j.status<>'running' or j.attempts is distinct from p_attempt
   or j.claim_token_hash is distinct from p_claim_token_hash or j.claim_expires_at<=clock_timestamp() then
   raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
 end if;
 if p_operation in('claim','check') then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request';end if;
  if p_operation='check' then
   update public.worker_jobs set claim_expires_at=least(clock_timestamp()+interval '5 minutes',v_deadline)
    where id=j.id returning * into j;
   -- Full current capture/payload equality was proved above. Avoid repeating
   -- the entire reviewed library in every bounded source checkpoint response.
   return jsonb_build_object('version','embryo-test-statistical-fit-check-v1','jobId',j.id,'attempt',j.attempts,
    'claimExpiresAt',j.claim_expires_at,'deadline',v_deadline,'captureSha256',v_hash);
  end if;
  return jsonb_build_object('version','embryo-test-statistical-fit-claim-v1',
   'jobId',j.id,'attempt',j.attempts,'claimExpiresAt',j.claim_expires_at,'deadline',v_deadline,
   'captureSha256',v_hash,'capture',a);
 elsif p_operation in('read') then
  if jsonb_typeof(p_payload) is distinct from 'object'
   or (select array_agg(k order by k) from jsonb_object_keys(p_payload) k) is distinct from
    array['conditionId','embryoId'] then
   raise exception using errcode='22023',message='invalid_request';end if;
  select value into e from jsonb_array_elements(a->'embryos') where value->>'embryoId'=p_payload->>'embryoId';
  select value into c from jsonb_array_elements(a->'conditions') where value->>'condition_id'=p_payload->>'conditionId';
  if e is null or c is null or e->'source'='null'::jsonb then
   raise exception using errcode='42501',message='embryo_test_statistical_unavailable';end if;
  return jsonb_build_object('version','embryo-test-statistical-fit-calls-v1','jobId',j.id,'attempt',j.attempts,
   'captureSha256',v_hash,'embryoId',e->'embryoId','conditionId',c->'condition_id',
   'calls',private.embryo_test_statistical_calls_v1(e));
 elsif p_operation='fail' then
  if p_payload is not null then raise exception using errcode='22023',message='invalid_request';end if;
  update public.worker_jobs set status='failed',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null where id=j.id;
  return '{"status":"failed"}'::jsonb;
 else
  if jsonb_typeof(p_payload) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(p_payload) k)
    is distinct from array['measurements'] or jsonb_typeof(p_payload->'measurements') is distinct from 'array'
    or jsonb_array_length(p_payload->'measurements')<>jsonb_array_length(a->'embryos')*jsonb_array_length(a->'conditions') then
   raise exception using errcode='22023',message='invalid_request';end if;
  for e in select value from jsonb_array_elements(a->'embryos') loop
   for c in select value from jsonb_array_elements(a->'conditions') loop
    expected:=private.expected_embryo_test_fit_measurement_v1(e,c);
    v_measurements:=v_measurements||jsonb_build_array(expected);
   end loop;
  end loop;
  if p_payload->'measurements' is distinct from v_measurements then
   raise exception using errcode='42501',message='embryo_test_statistical_measurement_mismatch';end if;
  select coalesce(max(sc.computation_revision),0)+1 into v_revision from public.embryo_scores sc
   join public.embryos embryo on embryo.id=sc.embryo_id where embryo.cohort_id=j.cohort_id;
  for e in select value from jsonb_array_elements(a->'embryos') loop
   for c in select value from jsonb_array_elements(a->'conditions') loop
    expected:=v_measurements->v_saved;
    insert into public.embryo_scores(embryo_id,condition_id,condition_name,finding,evidence_label,
     coverage_state,citation_ids,not_covered_reason,source_binding_fingerprint,computation_revision,computation_receipt)
    values((e->>'embryoId')::uuid,c->>'condition_id','Synthetic score coverage',
     nullif(expected->'finding','null'::jsonb),'preliminary',
     private.embryo_test_statistical_coverage_v1(expected),
     '{}',expected->>'reason',v_hash,v_revision,
     private.embryo_test_fit_receipt_v1(j,e,c,expected));
    v_saved:=v_saved+1;
   end loop;
  end loop;
  update public.worker_jobs set status='done',finished_at=clock_timestamp(),claim_token_hash=null,
   claim_expires_at=null,claimed_by=null,progress=100,progress_note='complete',
   partial=exists(select 1 from jsonb_array_elements(v_measurements) row where private.embryo_test_statistical_coverage_v1(row)<>'covered')
   where id=j.id;
  return jsonb_build_object('status','saved_held','jobId',j.id,'attempt',j.attempts,
   'captureSha256',v_hash,'saved',v_saved,'publication','synthetic-fitted-test-only');
 end if;
end $worker$;
revoke all on function public.embryo_test_statistical_fit_worker_v1(text,uuid,integer,text,jsonb,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.embryo_test_statistical_fit_worker_v1(text,uuid,integer,text,jsonb,boolean) to service_role;

-- Original complete native boundary, with a distinct fitted revision/receipt.
create function public.current_embryo_test_statistical_fit_v1(p_account uuid,p_session uuid,p_cohort uuid,p_test boolean)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='250ms'
set extra_float_digits=3 as $current_hold$
declare a jsonb; j public.worker_jobs; score public.embryo_scores; e jsonb; c jsonb;
 v_hash text; expected jsonb; v_count integer:=0; v_rows jsonb:='[]';
begin
 if p_test is distinct from true then raise exception using errcode='42501',message='not_found';end if;
 if private.current_embryo_test_fit_admission_v1() is null then return null;end if;
 perform private.lock_invitation_transitions_v1();
 perform 1 from public.subjects where cohort_id=p_cohort order by id for update;
 perform private.validate_sensitive_account_session_read_v1(p_account,p_session);
 if private.cohort_copilot_authority_v1(p_account,p_cohort) is null then raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end if;
 begin a:=private.capture_embryo_test_statistical_fit_v1(p_cohort,true);
 exception when insufficient_privilege then raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end;
 if a is null then raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end if;
 v_hash:=encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex');
 select * into j from public.worker_jobs where cohort_id=p_cohort and status='done'
  and kind='score_embryo' and output_kind='embryo.statistical-estimate'
  and computation_revision='embryo-test-statistical-fit-v1'
  and payload=jsonb_build_object('capture',a) and file_sha256=v_hash
  and source_binding_kind='cohort-source-set' and source_binding_id=p_cohort
  and source_binding_revision=(a->>'publicationRevision')::bigint
  and user_id=(a#>>'{authority,cohort,owner_account_id}')::uuid
  and subject_id is null and file_id is null and claim_token_hash is null and claim_expires_at is null
  and claimed_by is null order by finished_at desc,id limit 1 for share;
 if j.id is null then
  if exists(select 1 from public.worker_jobs where cohort_id=p_cohort and kind='score_embryo'
   and output_kind='embryo.statistical-estimate' and computation_revision='embryo-test-statistical-fit-v1') then
   raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end if;
  return null;
 end if;
 for e in select value from jsonb_array_elements(a->'embryos') loop
  for c in select value from jsonb_array_elements(a->'conditions') loop
   select * into score from public.embryo_scores where embryo_id=(e->>'embryoId')::uuid
    and condition_id=c->>'condition_id' and computation_receipt->>'job_id'=j.id::text
    and source_binding_fingerprint=v_hash order by computation_revision desc limit 1 for share;
   if score.id is null or not private.valid_embryo_test_fit_receipt_v1(score.computation_receipt)
    or score.computation_receipt->>'capture_sha256' is distinct from v_hash
    or (score.computation_receipt->>'attempt')::integer is distinct from j.attempts
    or score.computation_receipt->'source' is distinct from e->'source'
    or score.computation_receipt->'reference_receipt' is distinct from c->'reference_receipt' then raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end if;
   expected:=private.expected_embryo_test_fit_measurement_v1(e,c);
   if score.finding is distinct from nullif(expected->'finding','null'::jsonb)
    or score.not_covered_reason is distinct from expected->>'reason'
    or score.coverage_state is distinct from private.embryo_test_statistical_coverage_v1(expected)
    or score.computation_receipt is distinct from private.embryo_test_fit_receipt_v1(j,e,c,expected) then raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end if;
   if score.condition_name is distinct from 'Synthetic score coverage'
    or score.model_id is not null or score.model_version is not null
    or score.evidence_label is distinct from 'preliminary' or score.citation_ids is distinct from '{}'::text[] then raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end if;
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('embryoId',e->'embryoId','sampleOrdinal',e->'sampleOrdinal',
    'conditionId','SYNTHETIC:9001','conditionName','Synthetic score coverage','coverageState',score.coverage_state,
    'reason',score.not_covered_reason,'matchedVariants',expected#>'{measurement,matchedVariants}',
    'requiredVariants',expected#>'{measurement,requiredVariants}','scoreCoverage',expected#>'{measurement,scoreCoverage}',
    'finding',score.finding,'result',expected->'result','receipt',score.computation_receipt));
   v_count:=v_count+1;
  end loop;
 end loop;
 if (select count(*) from public.embryo_scores where computation_receipt->>'job_id'=j.id::text)<>v_count then raise exception using errcode='42501',message='embryo_test_statistical_fit_unavailable';end if;
 return jsonb_build_object('version',1,'producer','embryo-test-statistical-fit-v1','jurisdiction','TEST-LOCAL',
  'cohortId',p_cohort,'publicationRevision',a->'publicationRevision','jobId',j.id,'attempt',j.attempts,
  'captureSha256',v_hash,'interpretation','held','publication','synthetic-fitted-test-only','clinicalPublication',false,'rows',v_rows);
end $current_hold$;
revoke all on function public.current_embryo_test_statistical_fit_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function public.current_embryo_test_statistical_fit_v1(uuid,uuid,uuid,boolean) to service_role;

do $dispatch_predecessor$ declare p pg_catalog.pg_proc;begin
 select * into p from pg_catalog.pg_proc where oid=to_regprocedure('private.guard_embryo_carrier_score_v1()');
 if p.oid is null or md5(p.prosrc) is distinct from 'fcfcf16d11e63f288148315b6a20004b'
  or p.proowner is distinct from 'postgres'::regrole or p.prosecdef is distinct from true
  or p.prokind is distinct from 'f' or p.pronargs is distinct from 0 or p.prorettype is distinct from 'trigger'::regtype
  or p.proconfig is distinct from array['search_path=""','lock_timeout=250ms'] then
  raise exception using errcode='55000',message='synthetic_fit_predecessor_changed';end if;
end $dispatch_predecessor$;
create or replace function private.guard_embryo_carrier_score_v1() returns trigger
language plpgsql security definer set search_path='' set lock_timeout='250ms' as $score_guard$
declare j public.worker_jobs; a jsonb; e jsonb; c jsonb; expected jsonb; v_receipt jsonb;
begin
 if tg_op='UPDATE' then
  if old.computation_receipt is not null and to_jsonb(new) is distinct from to_jsonb(old) then
   raise exception using errcode='55000',message='embryo_carrier_score_immutable';end if;
  if new.computation_receipt is distinct from old.computation_receipt then
   raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
  return new;
 end if;
 if new.computation_receipt is null then return new;end if;
 if new.computation_receipt->>'producer'='embryo-test-statistical-fit-v1' then
  perform private.guard_embryo_test_fit_score_v1(new);return new;end if;
 if new.computation_receipt->>'producer'='embryo-test-score-coverage-v1' then
  perform private.guard_embryo_test_statistical_score_v1(new);return new;end if;
 if not private.valid_embryo_carrier_receipt_v1(new.computation_receipt) then
  raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 select * into j from public.worker_jobs where id=(new.computation_receipt->>'job_id')::uuid;
 if j.id is null or j.kind<>'score_embryo' or j.output_kind<>'embryo.carrier-match'
  or j.computation_revision<>'embryo-reviewed-allele-observation-v1' or j.status<>'running'
  or j.claim_expires_at<=clock_timestamp() or j.attempts<>(new.computation_receipt->>'attempt')::integer then
  raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 a:=private.capture_embryo_carrier_v1(j.cohort_id,true);
 if a is null or j.payload is distinct from jsonb_build_object('capture',a)
  or j.file_sha256 is distinct from encode(extensions.digest(convert_to(a::text,'UTF8'),'sha256'),'hex')
  or j.file_sha256 is distinct from new.computation_receipt->>'capture_sha256' then
  raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 select value into e from jsonb_array_elements(a->'embryos') where (value->>'embryoId')::uuid=new.embryo_id;
 select value into c from jsonb_array_elements(a->'conditions') where value->>'condition_id'=new.condition_id;
 if e is null or c is null then raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 expected:=private.expected_embryo_carrier_measurement_v1(e,c);
 v_receipt:=private.embryo_carrier_receipt_v1(j,e,c,expected);
 if new.computation_receipt is distinct from v_receipt
  or new.finding is distinct from nullif(expected->'observation','null'::jsonb)
  or new.condition_name is distinct from c#>>'{condition_registry,0,condition_name}'
  or new.not_covered_reason is distinct from expected->>'reason'
  or new.coverage_state is distinct from private.embryo_carrier_coverage_v1(expected)
  or new.source_binding_fingerprint is distinct from j.file_sha256
  or new.model_id is not null or new.model_version is not null
  or new.evidence_label is distinct from 'preliminary' or new.citation_ids is distinct from '{}'::text[] then
  raise exception using errcode='42501',message='embryo_carrier_unavailable';end if;
 return new;
end $score_guard$;
revoke all on function private.guard_embryo_carrier_score_v1() from public,anon,authenticated,inherit_upload_only,service_role;

alter table public.embryo_scores drop constraint embryo_scores_carrier_receipt_closed;
alter table public.embryo_scores add constraint embryo_scores_carrier_receipt_closed
 check(computation_receipt is null or private.valid_embryo_carrier_receipt_v1(computation_receipt)
  or private.valid_embryo_test_statistical_receipt_v1(computation_receipt) or private.valid_embryo_test_fit_receipt_v1(computation_receipt));

create function private.freeze_embryo_test_fit_job_v1() returns trigger
language plpgsql set search_path='' as $freeze_fit$
begin
 if old.computation_revision='embryo-test-statistical-fit-v1'
  and row(new.payload,new.user_id,new.file_id) is distinct from row(old.payload,old.user_id,old.file_id) then
  raise exception using errcode='23514',message='embryo_test_statistical_capture_immutable';end if;
 return new;
end $freeze_fit$;
create trigger embryo_test_fit_capture_immutable before update on public.worker_jobs
 for each row execute function private.freeze_embryo_test_fit_job_v1();

revoke all on function private.embryo_test_fit_decimal_v1(double precision) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.embryo_test_fit_decimal_tree_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.embryo_test_fit_array_text_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.embryo_test_fit_dot_v1(double precision[],double precision[]) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.embryo_test_fit_r2_v1(double precision[],double precision[]) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.embryo_test_fit_quadratic_v1(double precision[],jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.embryo_test_fit_package_raw_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.embryo_test_fit_package_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.embryo_test_fit_package_digest_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.embryo_test_fit_artifact_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.current_embryo_test_fit_admission_v1() from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.capture_embryo_test_statistical_fit_v1(uuid,boolean) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.evaluate_embryo_test_fit_v1(jsonb,jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.expected_embryo_test_fit_measurement_v1(jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.embryo_test_fit_receipt_v1(public.worker_jobs,jsonb,jsonb,jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.valid_embryo_test_fit_receipt_v1(jsonb) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.guard_embryo_test_fit_score_v1(public.embryo_scores) from public,anon,authenticated,inherit_upload_only,service_role;
revoke all on function private.freeze_embryo_test_fit_job_v1() from public,anon,authenticated,inherit_upload_only,service_role;
grant execute on function private.valid_embryo_test_fit_receipt_v1(jsonb) to service_role;
