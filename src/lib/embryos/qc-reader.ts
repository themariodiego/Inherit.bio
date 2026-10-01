import type {SupabaseClient} from "@supabase/supabase-js";
import {z} from "zod";
import type {Database} from "@/lib/supabase/types";
import {qcFigureBasisSchema} from "./qc-basis";

const number=z.number().finite(),nullable=number.nullable(),text=z.string().nullable();
const row=z.object({embryo_id:z.uuid(),sites_expected:number.int().nonnegative(),sites_called:number.int().nonnegative(),
 call_rate:number,autosomal_het_rate:nullable,mean_depth:nullable,parent_a_concordance:nullable,parent_b_concordance:nullable,
 allelic_dropout_estimate:nullable,allelic_dropout_interval_low:nullable,allelic_dropout_interval_high:nullable,
 allelic_dropout_method:text,amplification_method:text,source_laboratory:text,source_assay:text,
 imputation_performed:z.literal(false),imputation_panel:z.null(),contamination_estimate:nullable,
 qc_verdict:z.enum(["pass","marginal","fail"]),qc_reasons:z.array(z.string()),computed_at:z.string(),
 figure_basis:qcFigureBasisSchema.nullable()}).strict();
const selection=z.object({cohortId:z.uuid(),embryoIds:z.array(z.uuid()).min(1).max(64)}).strict()
 .refine(value=>new Set(value.embryoIds).size===value.embryoIds.length);
export type PreciseEmbryoQcRow=z.infer<typeof row>;
type Rpc=(name:"read_embryo_qc_rows_v1",args:{p_cohort_id:string;p_embryo_ids:string[]})=>PromiseLike<{data:unknown;error:unknown}>;
const failed=()=>({data:null,error:{message:"QC read unavailable"}} as const);

/** Called only after the existing authorized cohort/current result gates. The
 * service-only invoker RPC forms JSON with its own shortest-precise float
 * setting; no number is reconstructed, rounded or tolerated here. Exact cohort
 * identities, the complete closed row and later strict projection still apply.
 * The caller's existing authority gates and source facts remain unchanged. */
export async function readEmbryoQcRows(client:SupabaseClient<Database>,cohortId:string,embryoIds:string[]){
 const parsed=selection.safeParse({cohortId,embryoIds});if(!parsed.success)return failed();
 try{
  const rpc=client.rpc.bind(client) as unknown as Rpc;
  const result=await rpc("read_embryo_qc_rows_v1",{p_cohort_id:parsed.data.cohortId,p_embryo_ids:parsed.data.embryoIds});
  if(result.error!==null)return failed();const rows=z.array(row).min(1).max(64).safeParse(result.data);
  const expected=new Set(parsed.data.embryoIds);
  if(!rows.success||rows.data.length!==expected.size||new Set(rows.data.map(item=>item.embryo_id)).size!==expected.size
   ||rows.data.some(item=>!expected.has(item.embryo_id)))return failed();
  return {data:rows.data,error:null};
 }catch{return failed();}
}
