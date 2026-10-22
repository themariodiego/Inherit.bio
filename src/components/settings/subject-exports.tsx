import {AccountExport} from "@/components/settings/account-export";
import type {SubjectExportItem} from "@/lib/exports/subject-export-controls";
import {SUBJECT_EXPORT_ADULT_LABEL,SUBJECT_EXPORT_BODY,SUBJECT_EXPORT_HEADING,SUBJECT_EXPORT_JOINT_RESULTS,
 SUBJECT_EXPORT_SELF_LABEL} from "@/copy/subjects/subject-export";

/** One-record exports (api.subject-export). A record with live joint results
 * shows its stated refusal in place of the action. */
export function SubjectExports({items}:{items:SubjectExportItem[]}){
 return <section className="surface surface-pad rec-stack" aria-labelledby="subject-export-heading" data-slot="subject-exports">
  <h2 id="subject-export-heading" className="title">{SUBJECT_EXPORT_HEADING}</h2>
  <p className="max-w-measure text-sm leading-relaxed text-ink-muted">{SUBJECT_EXPORT_BODY}</p>
  {items.map(item=><div key={item.subjectId} className="space-y-2" data-slot="subject-export" data-subject={item.subjectId}>
   <p className="font-medium">{item.self?SUBJECT_EXPORT_SELF_LABEL:item.label??SUBJECT_EXPORT_ADULT_LABEL}</p>
   {"refusal" in item.control?<p role="status" className="text-sm" data-slot="subject-export-refusal">{SUBJECT_EXPORT_JOINT_RESULTS}</p>
    :<AccountExport control={item.control} route={item.route}/>}
  </div>)}
 </section>;
}
