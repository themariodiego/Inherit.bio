type Scoped={targetKind:string;targetId:string;actor:{accountId:string};partitions:readonly {subjectId:string;class:string}[]};
export type AccountArchiveScope="account"|"subject";

/** The two targets the account producer builds: the caller's whole account,
 * or one ordinary subject (api.subject-export, subject-export-v1) whose only
 * partition is the target itself. A claimed-bound subject job has its own
 * producer and is never either scope. Returns null for anything else. */
export function accountArchiveScope(context:Scoped):AccountArchiveScope|null{
 if(context.targetKind==="account")return context.targetId===context.actor.accountId?"account":null;
 return context.targetKind==="subject"&&context.partitions.length===1&&context.partitions[0].class==="ordinary"
  &&context.partitions[0].subjectId===context.targetId?"subject":null;
}
