import type { PublicAppealDecisionNotice as Notice } from "@/lib/future-person/public-appeal-decision-notice";

const labels = {
 "appeal-photo-identity": "File to check your name and age",
 "appeal-subject-source-control": "File for the source that is yours",
 "appeal-genetic-parent-authority": "File for your genetic parent link",
 "appeal-decision-notice": "The first review letter",
} as const;

/** This page is reached only through the native recipient-bound read. It has
 * no upload/action controls, target data, reviewer notes or authority selector. */
export function PublicAppealDecisionNotice({ notice }: { notice: Notice }) {
 return <section className="mx-auto max-w-3xl px-6 py-section">
  <header className="reading-head">
   <h1 className="display display-lg">Review of your files</h1>
   <p className="lede reading-intro">This is the review of a file from your request.</p>
  </header>
  <ul className="mt-8 space-y-8">
   {notice.decisions.map((row, index) => <li key={`${row.documentKind}-${index}`}>
    <h2 className="text-xl">{labels[row.documentKind]}</h2>
    <p>{row.decision === "approved" ? "Accepted" : "Refused"}</p>
    {row.decisionReference && <div>
     <p>Keep this reference if you ask for a review of this choice.</p>
     <p className="break-all font-mono" aria-label="Review reference">{row.decisionReference}</p>
    </div>}
   </li>)}
  </ul>
  <p className="mt-8">Acceptance of a file does not give access to a record or settle the request.</p>
  <p className="mt-4">The request keeps its original deadline: <time dateTime={notice.deadline}>{new Date(notice.deadline).toLocaleDateString("en-GB", { timeZone: "UTC" })}</time>.</p>
 </section>;
}
