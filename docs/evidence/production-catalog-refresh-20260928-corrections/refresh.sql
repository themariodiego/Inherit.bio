-- D-134: guarded refresh of the production report catalog; owner-approved 2026-09-28
-- (docs/protocol/decisions.md on PR #241: six reports corrected against their sources; plus the
-- two basic-traits rows whose only change is a dated citation). Seven rows of report_templates:
-- asparagus-odor-detection-or2m7, caffeine-intake-ahr-rs4410790, chronotype-per3-rs228697, motion-sickness-susceptibility, nicotine-dependence-chrna5-rs16969968, photic-sneeze-reflex-2q22, photic-sneeze-reflex-zeb2.
-- Predecessor digests are data/templates at 1291052fa9bd19dc095c5c7273b20fae32bd9b85;
-- successor digests are data/templates at 162c2a301ffb01ec9cbffa9089bf687ddc89c8ff.
-- Only title, summary, variants, citations and updated_at are written.
-- Completed reports are untouched: private.capture_own_report_catalog_v1 keeps them immutable, so a
-- saved report that captured the old wording keeps it and shows the scientific-correction notice.
do $refresh$
declare changed integer; matched integer; published integer;
begin
  perform set_config('lock_timeout', '1000', true);
  perform set_config('statement_timeout', '15000', true);
  perform set_config('idle_in_transaction_session_timeout', '15000', true);

  perform 1 from public.report_templates
   where slug in ('asparagus-odor-detection-or2m7', 'caffeine-intake-ahr-rs4410790', 'chronotype-per3-rs228697', 'motion-sickness-susceptibility', 'nicotine-dependence-chrna5-rs16969968', 'photic-sneeze-reflex-2q22', 'photic-sneeze-reflex-zeb2') order by slug for update;

  select count(*) into matched from public.report_templates t
  join (values
    ('asparagus-odor-detection-or2m7','90c915fb53391b279cebedce8aab32d3','1c646387e2c11e1e902dbd4e5a3b17ef','01791700cfebb84e6337917a4bb101a8','3eb4444ec45dd9af76a50bb6dbe043f4'),
    ('caffeine-intake-ahr-rs4410790','451217894d8317352cdeee59943dda3f','47e06fb7c11e9bc949a6defd17dac80f','bd0210d3b7513d4e0c7ca60c1cccd7bc','e714122b173733b2af24966ad02aba01'),
    ('chronotype-per3-rs228697','174e8ffd393d129cff4a6dcaebeb584a','93f6790a0e68dab110151bbd29bc24bd','9ae9c9f85dab4a13325229f22a0c8d34','80171d0ba7379e4a4e03f64bd56acb42'),
    ('motion-sickness-susceptibility','449b0dc0f59636034a9eadea2b4c6dcb','007eb0542dbc46a2729bf6c6d205e2e7','f2ca688f8ce51954d6243ffec849622f','e975c8081cdcc62caffa1699cd6c8d53'),
    ('nicotine-dependence-chrna5-rs16969968','e062d57f8c506fa24addaf3cfd345531','9c0f265fbebc2988e35dd56bd46d4a3b','ac082dfa3d7ce59d580a3ff6d4d84a2c','260bcdbc8927d1068d54203d4b8741db'),
    ('photic-sneeze-reflex-2q22','51325bcb089ec505a2e7ccb4918144a6','cb1166e8f35ee8f252719fed4bdfb482','12b5cd418374cc27f650423588e742e4','f9becb90ebb3e25cf33e1cd3270ab605'),
    ('photic-sneeze-reflex-zeb2','2c2b086ec428bfb14511a443b6a21a15','cd38f2e8e0cda80183dad0f14f5b1a2d','65dfd3b989619f0b303fa3433fc9e6c6','f3731bf0792912fa8ec79985a5fdca31')
  ) g(slug, t_md5, s_md5, v_md5, c_md5)
    on g.slug = t.slug and md5(t.title) = g.t_md5 and md5(t.summary) = g.s_md5
   and md5(t.variants::text) = g.v_md5 and md5(t.citations::text) = g.c_md5
  where t.status = 'published';
  if matched <> 7 then raise exception 'catalog_refresh_predecessor_guard: % of 7 rows hold the predecessor text', matched; end if;

  update public.report_templates set
    title = $t0$Smelling asparagus in urine · OR2M7 region$t0$,
    summary = $s0$A DNA region near smell receptor genes is linked to noticing an odor in urine after eating asparagus. The study asked people what they noticed. It did not separately measure their urine or test their sense of smell.$s0$,
    variants = $v0$[{"rsid": 4481887, "gene": "OR2M7", "chrom": 1, "pos38": 248333561, "ref": "A", "alt": "G", "interpretations": {"AA": "Your file shows two A copies. In the study, people with A copies more often reported noticing the odor than people with GG. One and two A copies gave similar results.", "AG": "Your file shows one A copy. In the study, this group more often reported noticing the odor than the GG group. Its result was close to the AA group, not halfway between.", "GG": "Your file shows two G copies. This group less often reported noticing the odor than groups with A copies. Even so, most people with GG in that study said they could smell it."}}]$v0$::jsonb,
    citations = $c0$[{"pmid": "20585627", "label": "Eriksson et al., PLoS Genet 2010", "accessedOn": "2026-09-06", "studyContext": {"measured": {"text": "An online survey asked whether people noticed an odor after eating asparagus.", "locator": "Methods, phenotype collection"}, "population": {"text": "The study used answers from 4,742 unrelated participants with northern European ancestry.", "locator": "Table 1 and Results, study population"}, "comparison": {"text": "Groups with one or two A copies more often noticed the odor than the GG group.", "locator": "Table 9 and Results, dominant model discussion"}, "limitation": {"text": "Self-reports cannot separate making an odor from detecting it. This position does not measure either process in you.", "locator": "Discussion, production versus detection; phenotype question"}}}, {"pmid": "27965198", "label": "Markt et al., BMJ 2016", "accessedOn": "2026-09-28"}]$c0$::jsonb,
    updated_at = now()
  where slug = 'asparagus-odor-detection-or2m7' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'asparagus-odor-detection-or2m7', changed; end if;
  update public.report_templates set
    title = $t1$Habitual caffeine intake · AHR$t1$,
    summary = $s1$AHR controls CYP1A2, a liver enzyme that clears most caffeine. A study of tens of thousands of people links C at rs4410790 to slightly more caffeine use. The two homozygous groups differed by about a third of a cup of coffee a day on average. Faster caffeine clearance may lead to more frequent use. The link repeats well but is tiny.$s1$,
    variants = $v1$[{"rsid": 4410790, "gene": "AHR", "chrom": 7, "pos38": 17244953, "ref": "T", "alt": "C", "interpretations": {"TT": "Two copies of the T allele. Associated on average with slightly lower habitual coffee and caffeine consumption than C carriers — a difference of a fraction of a cup a day at the population level. Personal preference, sleep habits, and culture matter far more.", "CT": "One C copy gives a middle result at this site. On average, CT is linked to slightly more daily caffeine than TT. A small rise in caffeine clearance may explain the link. The effect appears in large groups but is tiny for one person.", "CC": "Two C alleles. Associated with the highest average habitual coffee and caffeine intake at this locus — still only around a third of a cup of coffee per day more than TT on average. This describes consumption patterns, not caffeine's health effects."}}]$v1$::jsonb,
    citations = $c1$[{"pmid": "21490707", "label": "Cornelis et al., PLoS Genet 2011", "accessedOn": "2026-09-28"}]$c1$::jsonb,
    updated_at = now()
  where slug = 'caffeine-intake-ahr-rs4410790' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'caffeine-intake-ahr-rs4410790', changed; end if;
  update public.report_templates set
    title = $t2$Chronotype · PER3$t2$,
    summary = $s2$PER3 is a circadian clock gene long studied for links to sleep timing. The missense variant rs228697 (Pro864Ala) was associated with evening preference in a Japanese screening study: the minor G allele was more frequent among evening types and in people with a free-running circadian rhythm sleep disorder. The study found no link to delayed sleep-phase type. Evidence is early-stage and the effect, if real, is small.$s2$,
    variants = $v2$[{"rsid": 228697, "gene": "PER3", "chrom": 1, "pos38": 7827519, "ref": "C", "alt": "G", "interpretations": {"CC": "Two copies of the common C allele. In the available studies this genotype was not associated with a shift toward eveningness at this locus. Sleep timing is highly polygenic and strongly shaped by light, schedule, and age.", "CG": "One G copy was found more often among evening types and people with a free-running circadian rhythm in a Japanese study. The study groups were limited, so this is an early result. One DNA change has little effect on sleep timing, if any.", "GG": "Two copies of the less common G allele. If the reported association holds, this genotype would lean furthest toward evening preference at this locus, but the evidence base is small and needs replication in more populations."}}]$v2$::jsonb,
    citations = $c2$[{"pmid": "25201053", "label": "Hida et al., Sci Rep 2014", "accessedOn": "2026-09-28"}]$c2$::jsonb,
    updated_at = now()
  where slug = 'chronotype-per3-rs228697' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'chronotype-per3-rs228697', changed; end if;
  update public.report_templates set
    title = $t3$Tendency to motion sickness$t3$,
    summary = $s3$About one in three people is very prone to motion sickness. The trait has a strong inherited component. A study of car sickness in more than 80,000 people found dozens of variants with small effects. Several sit near genes involved in inner-ear and balance development. This report shows two of them.$s3$,
    variants = $v3$[{"rsid": 66800491, "gene": "3q13.2 intergenic region", "chrom": 3, "pos38": 109915280, "ref": "G", "alt": "A", "interpretations": {"AA": "Two copies of the A allele. Associated with somewhat higher reported car sickness than the G allele in the study above, which found effects up to three times stronger in women than in men.", "AG": "One copy of each allele, an intermediate result at this locus. Each variant found in this study shifted susceptibility only slightly; the trait reflects the sum of many such small contributions.", "GG": "Two copies of G, which the study linked to less reported car sickness. Each copy has a small effect. Habituation, what you look at while travelling and past experience also matter."}}, {"rsid": 2153535, "gene": "6p24.3 intergenic region", "chrom": 6, "pos38": 8369446, "ref": "C", "alt": "G", "interpretations": {"CC": "No copy of the G allele associated with motion sickness at this locus. Susceptibility here depends on many variants together rather than on any single one.", "CG": "One copy of the G allele, which was associated with slightly higher reported car sickness. This is an association across tens of thousands of people, not a prediction for any individual trip.", "GG": "Two copies of G, which the study linked to more reported car sickness. Motion sickness shares some genetic factors with migraine and nausea after surgery. This may help explain why it runs in families."}}]$v3$::jsonb,
    citations = $c3$[{"pmid": "25628336", "label": "Hromatka et al., Human Molecular Genetics 2015", "accessedOn": "2026-09-28"}]$c3$::jsonb,
    updated_at = now()
  where slug = 'motion-sickness-susceptibility' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'motion-sickness-susceptibility', changed; end if;
  update public.report_templates set
    title = $t4$Nicotine dependence · CHRNA5$t4$,
    summary = $s4$CHRNA5 makes part of the brain receptor that nicotine binds to. rs16969968 changes Asp398 to Asn. It is one of the most repeated findings in addiction genetics. Among smokers, each A copy is linked to about one more cigarette per day. It is also linked to higher odds of heavy smoking and nicotine dependence: a small shift.$s4$,
    variants = $v4$[{"rsid": 16969968, "gene": "CHRNA5", "chrom": 15, "pos38": 78590583, "ref": "G", "alt": "A", "interpretations": {"GG": "Two copies of the G allele, the reference genotype. In large studies, smokers with this genotype smoke slightly fewer cigarettes per day on average and have lower odds of nicotine dependence than A-allele carriers. This locus says nothing about whether someone smokes at all — social environment and choice dominate that.", "AG": "One copy of the A (Asn398) allele. Among people who smoke, this genotype is associated on average with slightly heavier smoking and modestly higher odds of nicotine dependence per A allele: a small shift. It is one small factor among many; it has no meaning for people who never smoke.", "AA": "Two copies of the A (Asn398) allele. Among smokers, this genotype is linked to the heaviest average cigarette use at this site. It also has higher odds of nicotine dependence than GG: a moderate shift. The effect is an average across large groups. Many AA people never smoke, or quit without trouble."}}]$v4$::jsonb,
    citations = $c4$[{"pmid": "17135278", "label": "Saccone et al., Hum Mol Genet 2007", "accessedOn": "2026-09-28"}, {"pmid": "18385739", "label": "Thorgeirsson et al., Nature 2008", "accessedOn": "2026-09-28"}]$c4$::jsonb,
    updated_at = now()
  where slug = 'nicotine-dependence-chrna5-rs16969968' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'nicotine-dependence-chrna5-rs16969968', changed; end if;
  update public.report_templates set
    title = $t5$Sneezing in bright light · 2q22 region$t5$,
    summary = $s5$Some people sneeze when they move into bright light. A study linked this reflex to a DNA region near ZEB2. It compared survey answers, not a controlled light test. The result describes a group pattern, not a certain response.$s5$,
    variants = $v5$[{"rsid": 10427255, "gene": "ZEB2", "chrom": 2, "pos38": 145367955, "ref": "C", "alt": "T", "interpretations": {"CC": "Your file shows two C copies. This group more often reported sneezing in bright light than the other groups in the study. Most people with CC still reported no reflex.", "CT": "Your file shows one C copy. Reports of sneezing in bright light fell between the CC and TT groups in this study. Your own response may differ.", "TT": "Your file shows two T copies. This group less often reported sneezing in bright light than groups with C copies. Some people with TT still had the reflex."}}]$v5$::jsonb,
    citations = $c5$[{"pmid": "20585627", "label": "Eriksson et al., PLoS Genet 2010", "accessedOn": "2026-09-06", "studyContext": {"measured": {"text": "People reported whether bright light made them sneeze.", "locator": "Methods, phenotype collection"}, "population": {"text": "The study included 5,390 unrelated participants with northern European ancestry.", "locator": "Table 1 and Results, study population"}, "comparison": {"text": "The C form was linked to more reports of this reflex. The reflex occurred in every genotype group.", "locator": "Tables 2 and 10"}, "limitation": {"text": "The region is near ZEB2, but the study did not prove that this gene causes the reflex.", "locator": "Results and Discussion, photic sneeze"}}}, {"pmid": "30899065", "label": "Wang et al., Sci Rep 2019", "accessedOn": "2026-09-28"}]$c5$::jsonb,
    updated_at = now()
  where slug = 'photic-sneeze-reflex-2q22' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'photic-sneeze-reflex-2q22', changed; end if;
  update public.report_templates set
    title = $t6$Photic sneeze reflex · rs10427255$t6$,
    summary = $s6$Some people sneeze when they step into bright sunlight. This harmless quirk is called the photic sneeze reflex. rs10427255 lies near ZEB2 on chromosome 2. A European-ancestry study linked the C allele to a higher chance of the reflex. A later Chinese study linked the reflex to the other allele, T, so the two groups point to opposite alleles.$s6$,
    variants = $v6$[{"rsid": 10427255, "gene": "ZEB2 region (2q22 intergenic)", "chrom": 2, "pos38": 145367955, "ref": "C", "alt": "T", "interpretations": {"CC": "Two copies of C. The European-ancestry study linked C to a higher chance of sneezing in bright light, with higher odds per copy: a small shift. The later Chinese study linked the T allele, not C, so the two groups disagree on direction.", "CT": "One copy of each allele, an intermediate result. Reported effect sizes at this variant are modest, and plenty of people with any genotype here do or do not sneeze in sunlight.", "TT": "Two copies of T. The European study linked C, not T, to a higher chance of the reflex, while the Chinese study linked T. The effect is modest, and people with any genotype may or may not sneeze in bright light."}}]$v6$::jsonb,
    citations = $c6$[{"pmid": "20585627", "label": "Eriksson et al., PLoS Genetics 2010", "accessedOn": "2026-09-28"}, {"pmid": "30899065", "label": "Wang et al., Scientific Reports 2019", "accessedOn": "2026-09-28"}]$c6$::jsonb,
    updated_at = now()
  where slug = 'photic-sneeze-reflex-zeb2' and status = 'published';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'catalog_refresh_update_count %: %', 'photic-sneeze-reflex-zeb2', changed; end if;

  select count(*) into matched from public.report_templates t
  join (values
    ('asparagus-odor-detection-or2m7','90c915fb53391b279cebedce8aab32d3','1c646387e2c11e1e902dbd4e5a3b17ef','01791700cfebb84e6337917a4bb101a8','8dd9c734802cb42845fc3ca31e720d35'),
    ('caffeine-intake-ahr-rs4410790','451217894d8317352cdeee59943dda3f','05fc8370a1e72ee311bf0f3da8a107bf','1bff3d211813967f7d28a0f40a1a19c0','164b3bf92e25a3482729b1966f9e8363'),
    ('chronotype-per3-rs228697','174e8ffd393d129cff4a6dcaebeb584a','ba72be6e763d58804b59112e45844719','93865b664de5640415507172a2a0420f','7f591649cca82e1adc741070b7914142'),
    ('motion-sickness-susceptibility','449b0dc0f59636034a9eadea2b4c6dcb','007eb0542dbc46a2729bf6c6d205e2e7','195fa77fc453e559165646c1f298e7f8','79ba035b3e0f4c2aa6ca26ccd2ed8b54'),
    ('nicotine-dependence-chrna5-rs16969968','e062d57f8c506fa24addaf3cfd345531','9c0f265fbebc2988e35dd56bd46d4a3b','ac082dfa3d7ce59d580a3ff6d4d84a2c','7931639c190e2f899d5c054b672f8290'),
    ('photic-sneeze-reflex-2q22','51325bcb089ec505a2e7ccb4918144a6','cb1166e8f35ee8f252719fed4bdfb482','12b5cd418374cc27f650423588e742e4','6bb72363fb8fee378a152819b3975191'),
    ('photic-sneeze-reflex-zeb2','2c2b086ec428bfb14511a443b6a21a15','f34f3b51aaa104be44ac3dcebf883817','3853cfa6a9ccc3898b8e5f8026981b2c','8be36a98241a39131c7ac13c6a566ff9')
  ) g(slug, t_md5, s_md5, v_md5, c_md5)
    on g.slug = t.slug and md5(t.title) = g.t_md5 and md5(t.summary) = g.s_md5
   and md5(t.variants::text) = g.v_md5 and md5(t.citations::text) = g.c_md5
  where t.status = 'published';
  if matched <> 7 then raise exception 'catalog_refresh_successor_check: % of 7 rows match the corrected text', matched; end if;

  select count(*) into published from public.report_templates where status = 'published';
  if published <> 162 then raise exception 'catalog_refresh_published_count: %', published; end if;
  -- Commit.
end
$refresh$;
