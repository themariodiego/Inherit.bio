-- D-134: guarded refresh of the production report catalog; owner-approved 2026-09-26, executed 2026-09-27.
-- The 11 Medicines (pharmacogenomics) rows: gene-first titles, drugs named only as what CPIC's guideline covers.
-- Predecessor digests are data/templates/medicines.json at bab8d7b79dc65f1b84ca4a4a510d651c4021836c;
-- successor digests are data/templates/medicines.json at main 9acfb1c46f9d9ec3d5e51ae36eae4d7460f5e9e9.
-- Only title, summary, variants, citations and updated_at change.
-- Completed reports are untouched: private.capture_own_report_catalog_v1 keeps them immutable.
do $refresh$
declare changed integer; matched integer; published integer;
begin
  perform set_config('lock_timeout', '1000', true);
  perform set_config('statement_timeout', '15000', true);
  perform set_config('idle_in_transaction_session_timeout', '15000', true);

  perform 1 from public.report_templates where slug in ('cyp2c19-rs12248560-one-position', 'cyp2c19-rs4244285-one-position', 'cyp2c9-rs1057910-one-position', 'cyp2c9-rs1799853-one-position', 'cyp3a5-rs776746-one-position', 'dpyd-rs3918290-one-position', 'nudt15-rs116855232-one-position', 'slco1b1-rs4149056-one-position', 'tpmt-rs1800460-one-position', 'tpmt-rs1800462-one-position', 'vkorc1-rs9923231-one-position') order by slug for update;

  select count(*) into matched from public.report_templates t
  join (values
    ('cyp2c19-rs12248560-one-position','042ab661e5039d76d98bbb0f764cb4ac','9dfefa87d82bac667c3492d7b0bc0247','14c5554953d9bd7f379394b737059b5e','067dd8910777ee2fa8c4ee004b11dae0'),
    ('cyp2c19-rs4244285-one-position','bd20ad0954adb9eb240ea12753318bb9','d3a87b8ea3ab85be9a0618a51a792d58','7cdfa485b4e261c331c09c1898f8c40c','067dd8910777ee2fa8c4ee004b11dae0'),
    ('cyp2c9-rs1057910-one-position','76504ca7d7126027d0badf619a7a4270','763923ad8955a0943c8ffa36fcdeb8db','8b41de9eefdb89f611586383e556a08d','00f53ce3f35b8dd8f969bd831ee54538'),
    ('cyp2c9-rs1799853-one-position','5a844a527a681e65fc4bc044b3ea3ca2','dfaa1457a06d8fa99b6952a65c13df8c','83f17c5240b6911c09473d697a5f218c','00f53ce3f35b8dd8f969bd831ee54538'),
    ('cyp3a5-rs776746-one-position','181ba5e050ee1abc47820e5ec7a58438','4698bd3981fcc7581509262d7b6c53a9','f43fde1a49eb80f1f16e3bdf7b6b08dd','c1943b347da73d7e918f4c660970af14'),
    ('dpyd-rs3918290-one-position','426bfb2fd2b0928f782671517384c9e1','e1debed5925ec5a6c451ba82a4560f13','26279cf7d95e5169637ccc8d7fe0cabf','7b73b33452f03630fd755fa81b74d92a'),
    ('nudt15-rs116855232-one-position','79cc7606c7436f98a6b5002b24ec5209','9e51ea0eb21fe203b1b413fb07f5ae44','106d4b9d75f5f4e5554b8b95fe73d027','a814aa152f0d1d5ceae69f1ff9d7b621'),
    ('slco1b1-rs4149056-one-position','15b0c43131b322c6d597646d7d67f28f','8f93248704fb03b58f58bd467d9dfb26','0d84c23c3a7af8485ec8b7ea07c23ffb','46abaae7c074a3ef9f427c0d7f0e602e'),
    ('tpmt-rs1800460-one-position','48779ed3cd957afe35c8fa7149528bbc','4360ae8a6b372bec41826cac5d4c4c90','5bfa4969028218864f0a9b1baab13db1','a814aa152f0d1d5ceae69f1ff9d7b621'),
    ('tpmt-rs1800462-one-position','38cad8fc688e11c67220f9f9473ee712','830e5c4e7d6808585937a7bb38530944','8ee0b09fbd516d111cc219de1721350d','a814aa152f0d1d5ceae69f1ff9d7b621'),
    ('vkorc1-rs9923231-one-position','6717b94789bcca99984ce25333b6a267','bef1af3fcc3b6c6765b6aff954046543','e341c68c0a4c712aad5ddf33e4140da8','16b25c0b64c73795d53944fd34083b78')
  ) g(slug, t_md5, s_md5, v_md5, c_md5)
    on g.slug = t.slug and md5(t.title) = g.t_md5 and md5(t.summary) = g.s_md5
   and md5(t.variants::text) = g.v_md5 and md5(t.citations::text) = g.c_md5
  where t.status = 'published';
  if matched <> 11 then raise exception 'catalog_refresh_predecessor_guard: % of 11 rows hold the predecessor text', matched; end if;

  update public.report_templates set
    title = $t0$CYP2C19, one position$t0$,
    summary = $s0$CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) uses 43 positions to name CYP2C19 forms. This reads one of them. A T here is part of the *17 form, and also of *44 and *45, so this is not a *17 call. CPIC's guideline for this gene covers clopidogrel. It cannot say how any medicine works in you.$s0$,
    variants = $v0$[{"rsid": 12248560, "gene": "CYP2C19", "chrom": 10, "pos38": 94761900, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows C on both copies at this position. C is the reference letter here. The other 42 positions CPIC uses are not read, so this is not a *1 call.", "CT": "Your file shows C on one copy and T on the other. T is part of the *17 form, and also of *44 and *45; *17 needs a second position not read here.", "TT": "Your file shows T on both copies at this position. T is part of the *17 form, and also of *44 and *45; *17 needs a second position not read here."}}]$v0$::jsonb,
    citations = $c0$[{"pmid": "35034351", "label": "CPIC guideline for CYP2C19 and clopidogrel, 2022 update, Clin Pharmacol Ther 2022", "accessedOn": "2026-09-03"}]$c0$::jsonb,
    updated_at = now()
  where slug = 'cyp2c19-rs12248560-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'cyp2c19-rs12248560-one-position', changed; end if;
  update public.report_templates set
    title = $t1$CYP2C19, the *2 position$t1$,
    summary = $s1$CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) uses 43 positions to name CYP2C19 forms. This reads the one where an A marks the *2 form. CPIC's guideline for this gene covers clopidogrel. It cannot say which pair of forms you carry, or how any medicine works in you.$s1$,
    variants = $v1$[{"rsid": 4244285, "gene": "CYP2C19", "chrom": 10, "pos38": 94781859, "ref": "G", "alt": "A", "interpretations": {"GG": "Your file shows G on both copies at this position. G is the letter of the reference-like *38 form here. The other 42 positions CPIC uses are not read, so this is not a *1 call.", "AG": "Your file shows A on one copy and G on the other. A is the letter of the *2 form at this position. Which forms your other positions carry is not read here.", "AA": "Your file shows A on both copies at this position. A is the letter of the *2 form. This is one position, not the pair of CYP2C19 forms you carry."}}]$v1$::jsonb,
    citations = $c1$[{"pmid": "35034351", "label": "CPIC guideline for CYP2C19 and clopidogrel, 2022 update, Clin Pharmacol Ther 2022", "accessedOn": "2026-09-03"}]$c1$::jsonb,
    updated_at = now()
  where slug = 'cyp2c19-rs4244285-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'cyp2c19-rs4244285-one-position', changed; end if;
  update public.report_templates set
    title = $t2$CYP2C9, the *3 position$t2$,
    summary = $s2$CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) reads 88 CYP2C9 positions across both copies. This reads the one where a C marks the *3 form; *18 and *68 carry it. CPIC's guidelines for this gene cover warfarin and NSAIDs. This cannot say which forms you carry, or how any medicine works in you.$s2$,
    variants = $v2$[{"rsid": 1057910, "gene": "CYP2C9", "chrom": 10, "pos38": 94981296, "ref": "A", "alt": "C", "interpretations": {"AA": "Your file shows A on both copies at this position. A is the reference letter here. The other 87 positions CPIC uses for CYP2C9 are not read.", "AC": "Your file shows A on one copy and C on the other. C is the letter of the *3 form here, and of *18 and *68. This is one position, not the pair of forms you carry.", "CC": "Your file shows C on both copies at this position. C is the letter of the *3 form, and of *18 and *68. This is one position, not the pair of forms you carry."}}]$v2$::jsonb,
    citations = $c2$[{"pmid": "28198005", "label": "CPIC guideline for pharmacogenetics-guided warfarin dosing, 2017 update, Clin Pharmacol Ther 2017", "accessedOn": "2026-09-03"}, {"pmid": "32189324", "label": "CPIC guideline for CYP2C9 and NSAIDs, Clin Pharmacol Ther 2020", "accessedOn": "2026-09-03"}]$c2$::jsonb,
    updated_at = now()
  where slug = 'cyp2c9-rs1057910-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'cyp2c9-rs1057910-one-position', changed; end if;
  update public.report_templates set
    title = $t3$CYP2C9, the *2 position$t3$,
    summary = $s3$CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) reads 88 CYP2C9 positions across both copies. This reads the one where a T marks the *2 form; *35, *61 and *92 carry it. CPIC's guidelines for this gene cover warfarin and NSAIDs. This cannot say which forms you carry, or how any medicine works in you.$s3$,
    variants = $v3$[{"rsid": 1799853, "gene": "CYP2C9", "chrom": 10, "pos38": 94942290, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows C on both copies at this position. C is the reference letter here. The other 87 positions CPIC uses for CYP2C9 are not read.", "CT": "Your file shows C on one copy and T on the other. T is the letter of the *2 form here, and of *35, *61 and *92. This is one position, not the pair of forms you carry.", "TT": "Your file shows T on both copies at this position. T is the letter of the *2 form, and of *35, *61 and *92. This is one position, not the pair of forms you carry."}}]$v3$::jsonb,
    citations = $c3$[{"pmid": "28198005", "label": "CPIC guideline for pharmacogenetics-guided warfarin dosing, 2017 update, Clin Pharmacol Ther 2017", "accessedOn": "2026-09-03"}, {"pmid": "32189324", "label": "CPIC guideline for CYP2C9 and NSAIDs, Clin Pharmacol Ther 2020", "accessedOn": "2026-09-03"}]$c3$::jsonb,
    updated_at = now()
  where slug = 'cyp2c9-rs1799853-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'cyp2c9-rs1799853-one-position', changed; end if;
  update public.report_templates set
    title = $t4$CYP3A5, the *3 position$t4$,
    summary = $s4$CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) uses 7 positions to name CYP3A5 forms. This reads the one where a C marks the *3 form. CPIC's guideline for this gene covers tacrolimus. It cannot say which pair of CYP3A5 forms you carry, or how any medicine works in you.$s4$,
    variants = $v4$[{"rsid": 776746, "gene": "CYP3A5", "chrom": 7, "pos38": 99672916, "ref": "T", "alt": "C", "interpretations": {"TT": "Your file shows T on both copies at this position. T is the letter of the *1 form here. The other 6 positions CPIC uses are not read, so this is not a *1 call.", "CT": "Your file shows C on one copy and T on the other. C is the letter of the *3 form at this position. This is one position, not the pair of CYP3A5 forms you carry.", "CC": "Your file shows C on both copies at this position. C is the letter of the *3 form. This is one position, not the pair of CYP3A5 forms you carry."}}]$v4$::jsonb,
    citations = $c4$[{"pmid": "25801146", "label": "CPIC guideline for CYP3A5 and tacrolimus dosing, Clin Pharmacol Ther 2015", "accessedOn": "2026-09-03"}]$c4$::jsonb,
    updated_at = now()
  where slug = 'cyp3a5-rs776746-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'cyp3a5-rs776746-one-position', changed; end if;
  update public.report_templates set
    title = $t5$DPYD, the *2A position$t5$,
    summary = $s5$This is one of the positions guidelines list for DPYD. C on both copies here says nothing about the other positions, which this report does not read. CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) uses 83 positions for DPYD. At this one, a T marks the *2A form. CPIC's guideline for this gene covers fluorouracil and capecitabine. It cannot say how any medicine works in you.$s5$,
    variants = $v5$[{"rsid": 3918290, "gene": "DPYD", "chrom": 1, "pos38": 97450058, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows C on both copies at this position. This is one of the positions guidelines list for DPYD. C on both copies here says nothing about the other positions, which this report does not read.", "CT": "Your file shows C on one copy and T on the other. T is the letter of the *2A form at this position. This is one position, not the pair of DPYD forms you carry.", "TT": "Your file shows T on both copies at this position. T is the letter of the *2A form. This is one position, not the pair of DPYD forms you carry."}}]$v5$::jsonb,
    citations = $c5$[{"pmid": "29152729", "label": "CPIC guideline for DPYD and fluoropyrimidine dosing, 2017 update, Clin Pharmacol Ther 2018", "accessedOn": "2026-09-03"}]$c5$::jsonb,
    updated_at = now()
  where slug = 'dpyd-rs3918290-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'dpyd-rs3918290-one-position', changed; end if;
  update public.report_templates set
    title = $t6$NUDT15, one position$t6$,
    summary = $s6$CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) uses 20 positions to name NUDT15 forms. This reads one position where T occurs in CPIC’s *3 definition. This is not a *3 call: the other positions and your pair of forms are not read here. CPIC's guideline for this gene covers thiopurine medicines. It cannot say how any medicine works in you.$s6$,
    variants = $v6$[{"rsid": 116855232, "gene": "NUDT15", "chrom": 13, "pos38": 48045719, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows C on both copies at this position. C is the letter of the *1 form here. The other 19 positions CPIC uses for NUDT15 are not read, so this is not a *1 call.", "CT": "Your file shows C on one copy and T on the other. T occurs in CPIC’s *3 definition. This report does not read the other positions or identify your pair of NUDT15 forms.", "TT": "Your file shows T on both copies at this position. T occurs in CPIC’s *3 definition. This report does not read the other positions or identify your pair of NUDT15 forms."}}]$v6$::jsonb,
    citations = $c6$[{"pmid": "41618934", "label": "CPIC guideline for TPMT and NUDT15 and thiopurine dosing, 2025 update, Clin Pharmacol Ther 2026", "accessedOn": "2026-09-03"}]$c6$::jsonb,
    updated_at = now()
  where slug = 'nudt15-rs116855232-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'nudt15-rs116855232-one-position', changed; end if;
  update public.report_templates set
    title = $t7$SLCO1B1, the *5 position$t7$,
    summary = $s7$CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) writes a statin guideline that reads three genes. This reads one SLCO1B1 position in one of them: where a C marks the *5 form; *15, *40 and *47 carry it. It cannot say how any medicine works in you.$s7$,
    variants = $v7$[{"rsid": 4149056, "gene": "SLCO1B1", "chrom": 12, "pos38": 21178615, "ref": "T", "alt": "C", "interpretations": {"TT": "Your file shows T on both copies at this position. T is the reference letter here. The other 34 positions CPIC uses for SLCO1B1 are not read, so this is not a *1 call.", "CT": "Your file shows C on one copy and T on the other. C is the letter of the *5 form here, and of *15, *40 and *47. This is one position, not the pair of forms you carry.", "CC": "Your file shows C on both copies at this position. C is the letter of the *5 form, and of *15, *40 and *47. This is one position, not the pair of forms you carry."}}]$v7$::jsonb,
    citations = $c7$[{"pmid": "35152405", "label": "CPIC guideline for SLCO1B1, ABCG2 and CYP2C9 and statin-associated musculoskeletal symptoms, Clin Pharmacol Ther 2022", "accessedOn": "2026-09-03"}]$c7$::jsonb,
    updated_at = now()
  where slug = 'slco1b1-rs4149056-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'slco1b1-rs4149056-one-position', changed; end if;
  update public.report_templates set
    title = $t8$TPMT, another position$t8$,
    summary = $s8$CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) uses 45 positions to name TPMT forms. This reads the one where a T marks the *3B form; with a second position, not read here, it is part of *3A. CPIC's guideline for this gene covers thiopurine medicines. It cannot say which pair of forms you carry, or how any medicine works in you.$s8$,
    variants = $v8$[{"rsid": 1800460, "gene": "TPMT", "chrom": 6, "pos38": 18138997, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows C on both copies at this position. C is the reference letter here. The other 44 positions CPIC uses for TPMT are not read, so this is not a *1 call.", "CT": "Your file shows C on one copy and T on the other. T is the letter of the *3B form here, and part of *3A with a second position not read here. This is one position, not the pair of forms you carry.", "TT": "Your file shows T on both copies at this position. T is the letter of the *3B form, and part of *3A with a second position not read here. This is one position, not the pair of forms you carry."}}]$v8$::jsonb,
    citations = $c8$[{"pmid": "41618934", "label": "CPIC guideline for TPMT and NUDT15 and thiopurine dosing, 2025 update, Clin Pharmacol Ther 2026", "accessedOn": "2026-09-03"}]$c8$::jsonb,
    updated_at = now()
  where slug = 'tpmt-rs1800460-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'tpmt-rs1800460-one-position', changed; end if;
  update public.report_templates set
    title = $t9$TPMT, the *2 position$t9$,
    summary = $s9$CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) uses 45 positions to name TPMT forms. This reads the one where a G marks the *2 form. CPIC's guideline for this gene covers thiopurine medicines. It cannot say which pair of TPMT forms you carry, or how any medicine works in you.$s9$,
    variants = $v9$[{"rsid": 1800462, "gene": "TPMT", "chrom": 6, "pos38": 18143724, "ref": "C", "alt": "G", "interpretations": {"CC": "Your file shows C on both copies at this position. C is the reference letter here. The other 44 positions CPIC uses for TPMT are not read, so this is not a *1 call.", "CG": "Your file shows C on one copy and G on the other. G is the letter of the *2 form at this position. This is one position, not the pair of TPMT forms you carry.", "GG": "Your file shows G on both copies at this position. G is the letter of the *2 form. This is one position, not the pair of TPMT forms you carry."}}]$v9$::jsonb,
    citations = $c9$[{"pmid": "41618934", "label": "CPIC guideline for TPMT and NUDT15 and thiopurine dosing, 2025 update, Clin Pharmacol Ther 2026", "accessedOn": "2026-09-03"}]$c9$::jsonb,
    updated_at = now()
  where slug = 'tpmt-rs1800462-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'tpmt-rs1800462-one-position', changed; end if;
  update public.report_templates set
    title = $t10$VKORC1, one position$t10$,
    summary = $s10$CPIC (a group of clinicians and scientists who write guidelines about genes and medicines) uses one position to name its two VKORC1 forms. This reads that position in VKORC1 and shows the letters your file has there. CPIC's guideline for this gene covers warfarin. It says nothing about how any medicine works in you, and it is not a dose.$s10$,
    variants = $v10$[{"rsid": 9923231, "gene": "VKORC1", "chrom": 16, "pos38": 31096368, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows C on both copies at this position. CPIC calls C the reference form of VKORC1. This says nothing about how any medicine works in you, and it is not a dose.", "CT": "Your file shows C on one copy and T on the other. CPIC calls T the variant form of VKORC1. This says nothing about how any medicine works in you, and it is not a dose.", "TT": "Your file shows T on both copies at this position. CPIC calls T the variant form of VKORC1. This says nothing about how any medicine works in you, and it is not a dose."}}]$v10$::jsonb,
    citations = $c10$[{"pmid": "28198005", "label": "CPIC guideline for pharmacogenetics-guided warfarin dosing, 2017 update, Clin Pharmacol Ther 2017", "accessedOn": "2026-09-03"}]$c10$::jsonb,
    updated_at = now()
  where slug = 'vkorc1-rs9923231-one-position' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'vkorc1-rs9923231-one-position', changed; end if;

  select count(*) into matched from public.report_templates t
  join (values
    ('cyp2c19-rs12248560-one-position','7b9e771afe9f0f49843e0fa06ec11ccb','749b13fe277b22ee294555e2b0c9fae0','14c5554953d9bd7f379394b737059b5e','067dd8910777ee2fa8c4ee004b11dae0'),
    ('cyp2c19-rs4244285-one-position','a69eb1964663389bc3b7fe0346c14c15','2ac90eff31548c816fa7ca6fc9e8e87d','7cdfa485b4e261c331c09c1898f8c40c','067dd8910777ee2fa8c4ee004b11dae0'),
    ('cyp2c9-rs1057910-one-position','4ff054f2b9928c4b2ef47ad3da3bf8fd','0c93e458a3450844c78eb5f14895d8ed','8b41de9eefdb89f611586383e556a08d','00f53ce3f35b8dd8f969bd831ee54538'),
    ('cyp2c9-rs1799853-one-position','71c702de93cee2b75604de0702598a3a','816e9fc2f9ce2ced37fc137f17ffa3ec','83f17c5240b6911c09473d697a5f218c','00f53ce3f35b8dd8f969bd831ee54538'),
    ('cyp3a5-rs776746-one-position','55641cc024b761c45f1faccff36e84a9','06e5fe8b43fc2e071b11dcd83bbd6390','f43fde1a49eb80f1f16e3bdf7b6b08dd','c1943b347da73d7e918f4c660970af14'),
    ('dpyd-rs3918290-one-position','95b73181106974bac71dbedb42a76191','0c82fa157943f685d974a13532fd8ee0','26279cf7d95e5169637ccc8d7fe0cabf','7b73b33452f03630fd755fa81b74d92a'),
    ('nudt15-rs116855232-one-position','40e81b703f5f0c0ec3ac4b32f580370c','2756e5875134a44f6b9d39533f932898','106d4b9d75f5f4e5554b8b95fe73d027','a814aa152f0d1d5ceae69f1ff9d7b621'),
    ('slco1b1-rs4149056-one-position','a529e7ff972107daae71c68ba5bf876c','a3b696f8e62c280270895616fbba44d4','0d84c23c3a7af8485ec8b7ea07c23ffb','46abaae7c074a3ef9f427c0d7f0e602e'),
    ('tpmt-rs1800460-one-position','f03a4833227cfe8c5ab2e9f74cdb2d65','869649937fd7c52ed18401cb4de6bfe6','5bfa4969028218864f0a9b1baab13db1','a814aa152f0d1d5ceae69f1ff9d7b621'),
    ('tpmt-rs1800462-one-position','4079ba2dcfeb54fc1f5944b50fe81c50','daa407c9511f51642363670675fa8761','8ee0b09fbd516d111cc219de1721350d','a814aa152f0d1d5ceae69f1ff9d7b621'),
    ('vkorc1-rs9923231-one-position','fff1179b13445fed7e49f4a279d9f11b','9e72975924742f9288c71b14652da1d4','73cd3bf816477ff33d094a770bc892e3','16b25c0b64c73795d53944fd34083b78')
  ) g(slug, t_md5, s_md5, v_md5, c_md5)
    on g.slug = t.slug and md5(t.title) = g.t_md5 and md5(t.summary) = g.s_md5
   and md5(t.variants::text) = g.v_md5 and md5(t.citations::text) = g.c_md5
  where t.status = 'published';
  if matched <> 11 then raise exception 'catalog_refresh_successor_check: % of 11 rows match main', matched; end if;

  select count(*) into published from public.report_templates where status = 'published';
  if published <> 162 then raise exception 'catalog_refresh_published_count: %', published; end if;
  -- Commit.
end
$refresh$;
