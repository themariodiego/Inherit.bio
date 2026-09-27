-- D-134: owner-approved guarded refresh of the production report catalog, 2026-09-25.
-- previousCommit -> correctedCommit for the eight batches of data/report-scientific-corrections.json,
-- content taken from main 57d6b4efd3247d91f2c144ad90d27ce3ca15d445. Predecessor digests are the registered previousCommit text;
-- successor digests are main's. Only title, summary, variants, citations and updated_at change.
-- Completed reports are untouched: private.capture_own_report_catalog_v1 keeps them immutable.
do $refresh$
declare changed integer; matched integer; published integer;
begin
  perform set_config('lock_timeout', '1000', true);
  perform set_config('statement_timeout', '15000', true);
  perform set_config('idle_in_transaction_session_timeout', '15000', true);

  perform 1 from public.report_templates where slug in ('alcohol-dependence-aldh2-rs671', 'apoe-e4-alzheimers-risk', 'breast-cancer-fgfr2-rs2981582', 'caffeine-sleep-adora2a-rs5751876', 'colorectal-apc-i1307k', 'factor-v-leiden-rs6025', 'trem2-r47h-alzheimers', 'type-2-diabetes-tcf7l2-rs7903146') order by slug for update;

  select count(*) into matched from public.report_templates t
  join (values
    ('alcohol-dependence-aldh2-rs671','937e8db67a0560ed021312662c7f1d64','71de893866ee03a80faa637daa1455ad','7b59f6ed51aba8279724c52002789148','1eb792ee2e2e9aea4068bcc0e91225e6'),
    ('apoe-e4-alzheimers-risk','8b65889775289a0f897bceeb97287284','7398be4f93c31fbdf7b58a934b9fa7c9','1546b58d741597903b85daee2ded3116','1383fbde5a020856ef7ed5dae490db16'),
    ('breast-cancer-fgfr2-rs2981582','b564e18c1d18ec080936ee01cca378b4','fe197d226c072ca1bc5af3145f15357f','5918c929e06bb54c57c1d5042d0f0a4b','4818160674a8c98591d9b620ebcf619f'),
    ('caffeine-sleep-adora2a-rs5751876','d6b0d7c9773204381811a031f6b112d0','c193c40f5d6db631e79fcbbfd31f1997','e6cec85405aa4daaee94264cba66cfa3','875699ffeb83643bcff03bb3f82e6276'),
    ('colorectal-apc-i1307k','377eb94fc52c67035429467e3fdfd939','8e664193d8081fd6fd39950d398e417d','5a83172c28d9efedf1ada17601db7ad9','47cc9df4aba2173620e3ecbb87c33cd8'),
    ('factor-v-leiden-rs6025','ac578b2f9868522babedc4fcc48e9ee4','8a2ae0e5b0ef0ce3c33543ed65cb1bab','43906d4d9dcbdf53d9f5bb27c6434e29','07b38399ff3aad602cb765fbe5fc8fb9'),
    ('trem2-r47h-alzheimers','3eabb17ca95bb86ac2670df5023d34f9','743b172f716050812c32ae4f77300fe2','a530a867bf76ffa38a67a16800773881','6f86f9c483f0655a8fa769bfef4281e6'),
    ('type-2-diabetes-tcf7l2-rs7903146','7b50a77870dd829d57ee63849bcef5f4','fd8a260c7f5b052b9225f3dabbb9be66','2758e77d44038c43c9f84f281f49d783','c591a84963098a1a897e53355d83b905')
  ) g(slug, t_md5, s_md5, v_md5, c_md5)
    on g.slug = t.slug and md5(t.title) = g.t_md5 and md5(t.summary) = g.s_md5
   and md5(t.variants::text) = g.v_md5 and md5(t.citations::text) = g.c_md5
  where t.status = 'published';
  if matched <> 8 then raise exception 'catalog_refresh_predecessor_guard: % of 8 rows hold the registered previousCommit text', matched; end if;

  update public.report_templates set
    title = $t0$Alcohol by-product breakdown · ALDH2$t0$,
    summary = $s0$ALDH2 helps clear acetaldehyde, a by-product of alcohol. The A form at rs671 lowers this enzyme’s activity and can cause flushing after drinking. Studies link this form to differences in drinking patterns. This report cannot predict your drinking habits, alcohol dependence or cancer risk.$s0$,
    variants = $v0$[{"rsid": 671, "gene": "ALDH2", "chrom": 12, "pos38": 111803962, "ref": "G", "alt": "A", "interpretations": {"GG": "Your file shows two G copies at rs671. It does not show the common A form linked to flushing. This position alone cannot tell how well your whole ALDH2 enzyme works, whether you flush, or whether you might develop alcohol dependence.", "AG": "Your file shows one A copy at rs671. This form reduces clearance of acetaldehyde, a by-product of alcohol. A study of Japanese men linked AG to higher odds of esophageal cancer than GG among drinkers, including the study’s light-drinking group. That group result does not give your personal risk or establish a safe amount.", "AA": "Your file shows two A copies at rs671. An early study found no measurable ALDH2 activity in two AA liver samples and higher blood acetaldehyde after alcohol than in GG. This small study does not tell how strongly you would react or how much you drink. It does not establish that AA carries more cancer risk than AG."}}]$v0$::jsonb,
    citations = $c0$[{"pmid": "19320537", "label": "Brooks et al., PLoS Med 2009 — research review", "accessedOn": "2026-09-23"}, {"pmid": "39075523", "label": "Rwere et al., J Transl Med 2024", "accessedOn": "2026-09-23"}, {"pmid": "12419833", "label": "Yokoyama et al., Carcinogenesis 2002", "accessedOn": "2026-09-23"}, {"pmid": "2024727", "label": "Enomoto et al., Alcohol Clin Exp Res 1991", "accessedOn": "2026-09-23"}]$c0$::jsonb,
    updated_at = now()
  where slug = 'alcohol-dependence-aldh2-rs671' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'alcohol-dependence-aldh2-rs671', changed; end if;
  update public.report_templates set
    title = $t1$Alzheimer's disease · APOE ε2/ε3/ε4$t1$,
    summary = $s1$Studies linked APOE ε3/ε4 and ε4/ε4 to higher odds of Alzheimer’s disease than ε3/ε3 in the groups studied. This report shows rs429358 and rs7412 separately. It does not assign an APOE type or estimate your personal risk. Some marker combinations also need information about which letters were inherited together.$s1$,
    variants = $v1$[{"rsid": 429358, "gene": "APOE", "chrom": 19, "pos38": 44908684, "ref": "T", "alt": "C", "interpretations": {"TT": "Your file shows two T copies at rs429358. This result is one part of APOE typing. This report does not combine it with rs7412 to assign your APOE type or a personal disease risk.", "CT": "Your file shows one C and one T copy at rs429358. This result is one part of APOE typing. This report does not combine it with rs7412 to assign your APOE type or a personal disease risk.", "CC": "Your file shows two C copies at rs429358. This result is one part of APOE typing. This report does not combine it with rs7412 to assign your APOE type or a personal disease risk."}}, {"rsid": 7412, "gene": "APOE", "chrom": 19, "pos38": 44908822, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows two C copies at rs7412. This result is one part of APOE typing. This report does not combine it with rs429358 to assign your APOE type or a personal disease risk.", "CT": "Your file shows one C and one T copy at rs7412. This result is one part of APOE typing. This report does not combine it with rs429358 to assign your APOE type or a personal disease risk.", "TT": "Your file shows two T copies at rs7412. This result is one part of APOE typing. This report does not combine it with rs429358 to assign your APOE type or a personal disease risk."}}]$v1$::jsonb,
    citations = $c1$[{"pmid": "8346443", "label": "Corder et al., Science 1993", "doi": "10.1126/science.8346443", "accessedOn": "2026-09-23"}, {"pmid": "9343467", "label": "Farrer et al., JAMA 1997", "doi": "10.1001/jama.1997.03550160069041", "accessedOn": "2026-09-23"}]$c1$::jsonb,
    updated_at = now()
  where slug = 'apoe-e4-alzheimers-risk' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'apoe-e4-alzheimers-risk', changed; end if;
  update public.report_templates set
    title = $t2$Breast cancer · FGFR2$t2$,
    summary = $s2$A study of women in European and Asian study groups linked the A allele at this FGFR2 marker to higher breast cancer odds. This is a group association, not a personal risk estimate. This report does not assess BRCA1, BRCA2 or other causes of hereditary cancer.$s2$,
    variants = $v2$[{"rsid": 2981582, "gene": "FGFR2", "chrom": 10, "pos38": 121592803, "ref": "A", "alt": "G", "interpretations": {"AA": "Your file shows two A copies. In the cited study, AA was associated with higher breast cancer odds than GG. This marker alone cannot tell you your chance of developing breast cancer.", "AG": "Your file shows one A and one G copy. In the cited study, AG was associated with higher breast cancer odds than GG. This marker alone cannot tell you your chance of developing breast cancer.", "GG": "Your file shows two G copies. GG was the comparison group in the cited study; AG and AA had higher breast cancer odds. A GG result does not rule out breast cancer or hereditary susceptibility."}}]$v2$::jsonb,
    citations = $c2$[{"pmid": "17529967", "doi": "10.1038/nature05887", "label": "Easton et al., Nature 2007", "accessedOn": "2026-09-23"}]$c2$::jsonb,
    updated_at = now()
  where slug = 'breast-cancer-fgfr2-rs2981582' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'breast-cancer-fgfr2-rs2981582', changed; end if;
  update public.report_templates set
    title = $t3$Caffeine, anxiety & sleep · ADORA2A$t3$,
    summary = $s3$The cited studies examined different responses to caffeine. TT was linked to greater anxiety after a single dose in infrequent users. CC was more common among people reporting sleep sensitivity. This marker does not predict your personal response.$s3$,
    variants = $v3$[{"rsid": 5751876, "gene": "ADORA2A", "chrom": 22, "pos38": 24441333, "ref": "T", "alt": "C", "interpretations": {"TT": "Your file shows two T copies. In one study of infrequent caffeine users, TT was linked to greater anxiety after 150 mg caffeine. TT was less common among people reporting sleep sensitivity than among those reporting little sensitivity.", "CT": "Your file shows one C and one T copy. These studies do not establish a general middle level of anxiety or sleep sensitivity for CT. They cannot predict your personal response.", "CC": "Your file shows two C copies. CC was more common among people reporting caffeine-related sleep sensitivity. This was a group association. It cannot tell you your own sensitivity or caffeine limit."}}]$v3$::jsonb,
    citations = $c3$[{"pmid": "12825092", "doi": "10.1038/sj.npp.1300232", "label": "Alsene et al., Neuropsychopharmacology 2003", "accessedOn": "2026-09-23"}, {"pmid": "17329997", "doi": "10.1038/sj.clpt.6100102", "label": "Rétey et al., Clin Pharmacol Ther 2007", "accessedOn": "2026-09-23"}]$c3$::jsonb,
    updated_at = now()
  where slug = 'caffeine-sleep-adora2a-rs5751876' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'caffeine-sleep-adora2a-rs5751876', changed; end if;
  update public.report_templates set
    title = $t4$Colorectal cancer · APC I1307K$t4$,
    summary = $s4$APC I1307K is the A form at rs1801155. A review of studies in people of Ashkenazi Jewish ancestry linked it to higher colorectal cancer odds. Evidence in other populations is less clear. This report does not estimate your cancer risk or test for familial adenomatous polyposis.$s4$,
    variants = $v4$[{"rsid": 1801155, "gene": "APC", "chrom": 5, "pos38": 112839514, "ref": "T", "alt": "A", "interpretations": {"TT": "Your file shows two T copies at this position, so it does not show the I1307K A form. This one marker does not rule out colorectal cancer or other APC changes. It cannot set your screening plan.", "AT": "Your file shows one A and one T copy. Higher colorectal cancer odds were reported in Ashkenazi Jewish study groups. We cannot assume the same link in every population. A later UK Biobank study was too small to settle the link. This result alone does not set your screening plan.", "AA": "Your file shows two A copies. Too few people with this result have been studied to say whether two copies carry more risk than one. Do not assume twice the risk. This report does not estimate your chance of cancer."}}]$v4$::jsonb,
    citations = $c4$[{"pmid": "9288102", "label": "Laken et al., Nat Genet 1997", "accessedOn": "2026-09-23"}, {"pmid": "37076288", "label": "Valle et al., J Med Genet 2023", "accessedOn": "2026-09-23"}, {"pmid": "40866199", "label": "Allen et al., J Med Genet 2025", "accessedOn": "2026-09-23"}]$c4$::jsonb,
    updated_at = now()
  where slug = 'colorectal-apc-i1307k' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'colorectal-apc-i1307k', changed; end if;
  update public.report_templates set
    title = $t5$Factor V Leiden · F5$t5$,
    summary = $s5$Factor V Leiden is the T change at rs6025 in F5. It can make clotting factor V harder for activated protein C to turn off. A Danish adult study linked one or two T copies to more blood clots in veins. This site alone does not give your personal risk.$s5$,
    variants = $v5$[{"rsid": 6025, "gene": "F5", "chrom": 1, "pos38": 169549811, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows two C copies at rs6025. It does not show the Factor V Leiden T change at this site. This does not rule out other causes of blood clots or measure your overall clot risk.", "CT": "Your file shows one C and one T copy at rs6025. In a Danish adult study, one copy was linked to more blood clots in veins than no copies. The chance varies with age and personal circumstances. This result does not give your own probability.", "TT": "Your file shows two T copies at rs6025. In a Danish adult study, two copies were linked to higher vein-clot risk than one copy. A clot is not certain, and this result does not give your personal chance of one."}}]$v5$::jsonb,
    citations = $c5$[{"pmid": "8164741", "label": "Bertina et al., Nature 1994", "doi": "10.1038/369064a0", "accessedOn": "2026-09-23"}, {"pmid": "14996674", "doi": "10.7326/0003-4819-140-5-200403020-00008", "label": "Juul et al., Annals of Internal Medicine 2004", "accessedOn": "2026-09-23"}]$c5$::jsonb,
    updated_at = now()
  where slug = 'factor-v-leiden-rs6025' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'factor-v-leiden-rs6025', changed; end if;
  update public.report_templates set
    title = $t6$Alzheimer's disease · TREM2 R47H$t6$,
    summary = $s6$Studies linked the T variant at TREM2 R47H to higher odds of late-onset Alzheimer’s disease in the groups studied. This association does not tell you whether or when the condition might affect you.$s6$,
    variants = $v6$[{"rsid": 75932628, "gene": "TREM2", "chrom": 6, "pos38": 41161514, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows two C copies at this position, so it does not show the T variant known as R47H. This report does not assess other TREM2 variants or your overall chance of developing Alzheimer’s disease.", "CT": "Your file shows one C and one T copy. The cited studies linked the R47H T variant to higher odds of Alzheimer’s disease in their study groups. They do not provide your personal lifetime chance of developing the condition.", "TT": "Your file shows two T copies at this position. This report does not provide a separate risk estimate for this two-copy result or verify the accuracy of the original DNA test."}}]$v6$::jsonb,
    citations = $c6$[{"pmid": "23150908", "label": "Jonsson et al., N Engl J Med 2013", "doi": "10.1056/NEJMoa1211103", "accessedOn": "2026-09-23"}, {"pmid": "23150934", "label": "Guerreiro et al., N Engl J Med 2013", "doi": "10.1056/NEJMoa1211851", "accessedOn": "2026-09-23"}]$c6$::jsonb,
    updated_at = now()
  where slug = 'trem2-r47h-alzheimers' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'trem2-r47h-alzheimers', changed; end if;
  update public.report_templates set
    title = $t7$Type 2 diabetes · TCF7L2$t7$,
    summary = $s7$TCF7L2 rs7903146 has been linked to type 2 diabetes. One trial studied overweight people with high blood sugar. TT was linked to a higher rate of diabetes than CC over about three years. These group results do not give your personal chance of diabetes.$s7$,
    variants = $v7$[{"rsid": 7903146, "gene": "TCF7L2", "chrom": 10, "pos38": 112998590, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows two C copies at rs7903146. CC was the comparison group in the trial. People with this genotype also developed diabetes, so this result does not rule it out.", "CT": "Your file shows one C and one T at rs7903146. The trial did not find a higher rate of diabetes in CT than CC. This does not prove there is no effect; the study may have been too small to detect it.", "TT": "Your file shows two T copies at rs7903146. In the trial, TT was linked to a higher rate of diabetes than CC. That result describes a group with high blood sugar, not your lifetime chance of diabetes."}}]$v7$::jsonb,
    citations = $c7$[{"pmid": "16415884", "label": "Grant et al., Nat Genet 2006", "doi": "10.1038/ng1732", "accessedOn": "2026-09-23"}, {"pmid": "16855264", "label": "Florez et al., N Engl J Med 2006", "doi": "10.1056/NEJMoa062418", "accessedOn": "2026-09-23"}]$c7$::jsonb,
    updated_at = now()
  where slug = 'type-2-diabetes-tcf7l2-rs7903146' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'type-2-diabetes-tcf7l2-rs7903146', changed; end if;

  select count(*) into matched from public.report_templates t
  join (values
    ('alcohol-dependence-aldh2-rs671','ec6b562d7b9d528fee623a1cfb22a5dd','8ed17b09b73bd755c2ca086952f09628','add3d432e938d433010f9acc415a71e5','9634353e71ad40729cfcf732fd87b0bb'),
    ('apoe-e4-alzheimers-risk','8b65889775289a0f897bceeb97287284','09609a8760b0096aa258d2cc75ab2210','4ec4f14ae1e8120be4787c502b84b3e4','3b386944eb1d7487ec19ad315ef7b3d4'),
    ('breast-cancer-fgfr2-rs2981582','b564e18c1d18ec080936ee01cca378b4','59437328e2c0c7dbbcad4ba551313361','3844d27af96283952b455da56cef4c5e','ca79af10b858fce77e8d68e8bbc69c4f'),
    ('caffeine-sleep-adora2a-rs5751876','d6b0d7c9773204381811a031f6b112d0','b3b50ee9d0e1af4cb7ad183b0e40307b','0436519757ca4a63dd121ae4f3933543','753eb6a8ccb853d6452a4a8137e25637'),
    ('colorectal-apc-i1307k','377eb94fc52c67035429467e3fdfd939','8f88b1c1379775079080d83aafce644f','77d194ce1017f7ec419cb05d82dc9f1e','0c8662f0a1f9f5086802bbbb58a2babc'),
    ('factor-v-leiden-rs6025','ac578b2f9868522babedc4fcc48e9ee4','f66f088a51e752493081e97bb2ff452d','2d003fa91aa190f6a537c26ebf6478a8','3a1918cd06e9e8fdf2329fd2fcdc8e00'),
    ('trem2-r47h-alzheimers','3eabb17ca95bb86ac2670df5023d34f9','7c929c9b863ba2d0ae85438bd5aa5df1','2308e6084e66be985e3875f37429ae5c','2212d2300edc2bf303f05d2776806fcc'),
    ('type-2-diabetes-tcf7l2-rs7903146','7b50a77870dd829d57ee63849bcef5f4','981635967d676e20ada98e9385c4b3c7','b31ce8cb3af798d7f0a1e01f1c63ebde','e28b8f4370d5b1fc88d79f29c50c5440')
  ) g(slug, t_md5, s_md5, v_md5, c_md5)
    on g.slug = t.slug and md5(t.title) = g.t_md5 and md5(t.summary) = g.s_md5
   and md5(t.variants::text) = g.v_md5 and md5(t.citations::text) = g.c_md5
  where t.status = 'published';
  if matched <> 8 then raise exception 'catalog_refresh_successor_check: % of 8 rows match main', matched; end if;

  select count(*) into published from public.report_templates where status = 'published';
  if published <> 162 then raise exception 'catalog_refresh_published_count: %', published; end if;
  -- Commit.
end
$refresh$;
