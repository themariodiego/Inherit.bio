import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks = vi.hoisted(() => ({ client: vi.fn(), admin: vi.fn(), people: vi.fn(), self: vi.fn(), capability: vi.fn(), acknowledged: vi.fn(),
  snapshot: vi.fn(), templates: vi.fn(), genotypes: vi.fn(), provenance: vi.fn(), classified: vi.fn(), conditions: vi.fn(), pair: vi.fn() }));
vi.mock('../supabase/server', () => ({ createClient: mocks.client }));
vi.mock('../supabase/admin', () => ({ createAdminClient: mocks.admin }));
vi.mock('../subjects', () => ({ resolveSubjectForAccount: mocks.self }));
vi.mock('./graph', () => ({ listFamilyPeople: mocks.people }));
vi.mock('./access', () => ({ familyCapability: mocks.capability, permits: (decision: { status: string }) => decision.status === 'permitted',
  viewerMaySee: (person: { grantsToViewer: Set<string>; sharing: string }, purpose: string) => person.sharing === 'active' && person.grantsToViewer.has(purpose),
  LAYER_PURPOSES: { variant_call: 'reports.monogenic', estimate: 'reports.polygenic' } }));
vi.mock('./tier2', () => ({ acknowledged: mocks.acknowledged }));
vi.mock('./health-picture-results', () => ({ loadHealthPictureSnapshot: mocks.snapshot }));
vi.mock('../genome/load', () => ({ getPublishedTemplates: mocks.templates, getSubjectGenotypesByRsid: mocks.genotypes,
  templateRsids: (templates: { variants: { rsid: number }[] }[]) => templates.flatMap(template => template.variants.map(variant => variant.rsid)) }));
vi.mock('../genome/input-sources', () => ({ loadInputSources: mocks.provenance }));
vi.mock('./carrier-pair', () => ({ readClassifiedVariants: mocks.classified, readCarrierConditions: mocks.conditions, resolveCarrierPair: mocks.pair }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => h('a', { href, ...rest }, children) }));
vi.mock('../../components/family/result-gate', () => ({ ResultGate: () => h('p', null, 'Tier2 gate') }));
const { default: Page } = await import('../../app/(app)/family/health-picture/page');
import type { HealthPictureState } from './health-picture-results';
const id = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const subjectA=id(1), subjectB=id(2), accountA=id(3), accountB=id(4), handleB=id(5), legacyFile=id(6);
const subject = (subjectId: string, accountId: string) => ({ id: subjectId, subjectClass: 'self', lifecycle: 'active', lifecycleRevision: 1,
  routeSegment: 'me', displayLabel: 'You', ownerAccountId: accountId, subjectAccountId: accountId });
let capture: HealthPictureState;
let calls: string[];
let confirm: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks(); calls=[];
  mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: accountA } } }) } }); mocks.admin.mockReturnValue({});
  mocks.self.mockResolvedValue(subject(subjectA,accountA));
  mocks.people.mockResolvedValue([{ handle: { ...subject(handleB,accountB), subjectClass: 'other_adult', routeSegment:`s-${handleB}`, ownerAccountId:null },
    dataSubjectId:subjectB, counterpartAccountId:accountB, displayLabel:'Another adult', sharing:'active',
    grantsToViewer:new Set(['family.heritability','reports.polygenic']), grantsFromViewer:new Set(['family.heritability']) }]);
  mocks.capability.mockResolvedValue({ status:'permitted' }); mocks.acknowledged.mockResolvedValue(true);
  capture={authorized:true,columns:[subjectA,subjectB].map((subjectId,index)=>({subjectId,kind:index===0?'own':'shared',
    access:[{purpose:'reports.monogenic',kind:'not-shared',hasPreparedSource:false,hasCompletedSource:false},
      {purpose:'reports.polygenic',kind:'canonical',hasPreparedSource:true,hasCompletedSource:false}],
    reports:[],sources:[],legacyFileIds:[],unavailableReports:[]}))};
  confirm=vi.fn(async()=>{calls.push('confirm');return capture;});
  mocks.snapshot.mockImplementation(async()=>({state:capture,confirm}));
  mocks.templates.mockImplementation(async()=>{calls.push('templates');return [{slug:'caffeine',title:'Legacy caffeine',category:'basic-traits',layer:'estimate',
    summary:'Earlier report',evidence:'preliminary',citations:[],variants:[{rsid:762551,chrom:15,pos38:74749576,gene:'CYP1A2',ref:'A',alt:'C',interpretations:{AC:'Stored legacy call'}}]}];});
  mocks.genotypes.mockImplementation(async()=>{calls.push('genotypes');return {genotypes:new Map([[762551,'AC']]),conflicts:new Set(),fileCount:1,
    inputFileIds:[legacyFile],checkedFileIds:[legacyFile],inputFilesByRsid:new Map([[762551,new Set([legacyFile])]])};});
  mocks.provenance.mockImplementation(async()=>{calls.push('provenance');return [{fileId:legacyFile,fileType:'vcf',processedAt:null,snapshot:null}];});
  mocks.classified.mockResolvedValue([]); mocks.conditions.mockResolvedValue([]);
  mocks.pair.mockImplementation(async()=>{calls.push('pair');return {matches:[],classifiedPositions:0,positionsBothCover:0,genotypes:{a:new Map(),b:new Map()}};});
});

describe('Health Picture final rendering boundary',()=>{
  it('does not read results before the existing Tier2 gate',async()=>{
    mocks.acknowledged.mockResolvedValue(false);
    expect(renderToStaticMarkup(await Page())).toContain('Tier2 gate');
    expect(mocks.snapshot).not.toHaveBeenCalled(); expect(mocks.genotypes).not.toHaveBeenCalled();
  });
  it('renders explicit source-only states with no legacy/catalog/count reads and no File0',async()=>{
    const html=renderToStaticMarkup(await Page());
    expect(html).toContain('No saved reports for the prepared files yet'); expect(html).toContain('Not shared with you');
    expect(html).not.toContain('File 0'); expect(html).not.toContain('data-slot="subject-files"');
    expect(mocks.templates).not.toHaveBeenCalled(); expect(mocks.genotypes).not.toHaveBeenCalled();
    expect(calls.at(-1)).toBe('confirm'); expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('reads only captured legacy IDs for the permitted purpose, then confirms after provenance',async()=>{
    capture.columns[1].legacyFileIds=[legacyFile]; capture.columns[1].access[1].kind='legacy-only';
    const html=renderToStaticMarkup(await Page());
    expect(mocks.genotypes).toHaveBeenCalledExactlyOnceWith({},subjectB,[762551],[legacyFile]);
    expect(mocks.provenance).toHaveBeenCalledWith({},subjectB,[legacyFile]);
    expect(html).toContain('Legacy caffeine'); expect(html).toContain(`s-${handleB}/reports/caffeine?source=legacy`);
    expect(calls.at(-1)).toBe('confirm');
  });
  it('never invokes legacy genotype resolution for unsupported catalog layers',async()=>{
    capture.columns[1].legacyFileIds=[legacyFile]; capture.columns[1].access[1].kind='legacy-only';
    mocks.templates.mockResolvedValue([{ slug:'outside',title:'Outside layer',layer:'clinical',variants:[{rsid:762551}] }]);
    const html=renderToStaticMarkup(await Page());
    expect(mocks.genotypes).not.toHaveBeenCalled(); expect(mocks.provenance).not.toHaveBeenCalled();
    expect(html).not.toContain('Outside layer'); expect(calls.at(-1)).toBe('confirm');
  });
  it('preserves own legacy results and exact absent contributors while withholding an unsafe own link',async()=>{
    for (const column of capture.columns) { column.legacyFileIds=[legacyFile]; column.access[1].kind='legacy-only'; }
    mocks.genotypes.mockImplementation(async(_db,subjectId)=>({genotypes:subjectId===subjectA?new Map([[762551,'AC']]):new Map(), conflicts:new Set(),fileCount:1,
      inputFileIds:subjectId===subjectA?[legacyFile]:[],checkedFileIds:[legacyFile],inputFilesByRsid:subjectId===subjectA?new Map([[762551,new Set([legacyFile])]]):new Map()}));
    const html=renderToStaticMarkup(await Page());
    expect(html).toContain('Legacy caffeine'); expect(html).toContain('no position recorded in the checked files');
    expect(html).toContain('This file was checked but supplied no record'); expect(html).toContain('No record was available at the positions this result uses');
    expect(html).not.toContain('/genome/me/reports/caffeine'); expect(html).not.toContain('File 0');
    expect(html).toContain('Legacy caffeine — File 1'); expect(calls.at(-1)).toBe('confirm');
  });
  it('not-shared overrides captured legacy IDs, with zero legacy reads',async()=>{
    capture.columns[1].legacyFileIds=[legacyFile];capture.columns[1].access[1].kind='not-shared';
    await Page(); expect(mocks.genotypes).not.toHaveBeenCalled(); expect(mocks.templates).not.toHaveBeenCalled();
  });
  it('withholds precomputed legacy rows if confirmation replaces the captured state',async()=>{
    capture.columns[1].legacyFileIds=[legacyFile];capture.columns[1].access[1].kind='legacy-only';
    confirm.mockImplementation(async()=>({authorized:true,columns:capture.columns.map(column=>({...column,
      access:column.access.map(access=>({...access,kind:'not-shared'}))}))}));
    const html=renderToStaticMarkup(await Page());
    expect(html).toContain('This view is no longer available');expect(html).not.toContain('Legacy caffeine');
  });
  it('withdrawal of one joint column during provenance withholds ALL prior output after final confirmation',async()=>{
    capture.columns[1].legacyFileIds=[legacyFile];capture.columns[1].access[1].kind='legacy-only';
    confirm.mockImplementation(async()=>{calls.push('confirm');return {authorized:false,columns:[]};});
    const html=renderToStaticMarkup(await Page());
    expect(html).toContain('This view is no longer available'); expect(html).not.toContain('Legacy caffeine');
    expect(html).not.toContain('data-compare-surface'); expect(html).not.toContain('input-provenance');
    expect(calls).toContain('provenance'); expect(calls.at(-1)).toBe('confirm'); expect(confirm).toHaveBeenCalledTimes(1);
  });
});
