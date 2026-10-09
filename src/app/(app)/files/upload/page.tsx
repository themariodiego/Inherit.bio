import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { OwnUploadEntry } from "@/components/uploads/own-upload-entry";
import { OtherAdultUploadSection } from "@/components/uploads/other-adult-upload-section";
import { NAV_LABELS } from "@/copy/navigation";
import { route } from "@/lib/primary-routes";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createClient } from "@/lib/supabase/server";

const UPLOAD_H1 = "Add your genome file";

export const metadata: Metadata = { title: "Add a file" };

export default async function FileUploadPage() {
  // The crumbs name the record the file joins: the account's own subject,
  // read only for its label (round-2 M8). They replace the "Files" eyebrow.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const self = user ? await resolveSubjectForAccount(user.id, "me") : null;
  return (
    <div className="page-stack rec-column stack-sections">
      <header className="rec-head">
        {self ? (
          <Breadcrumbs
            items={[
              { label: NAV_LABELS["my-genome"], href: route("genome.subject", { subject: self.routeSegment }) },
              { label: self.displayLabel },
              { label: UPLOAD_H1 },
            ]}
          />
        ) : (
          <p className="eyebrow">Files</p>
        )}
        <h1 className="display">{UPLOAD_H1}</h1>
        <p className="lede">
          You can add only your own genome here. Family and embryo uploads stay
          off until their separate consent and legal rules are met.
        </p>
      </header>
      <OwnUploadEntry />
      <OtherAdultUploadSection />
      <p className="text-sm">
        <Link href={route("files.index")} className="link-target quiet-link">← All files</Link>
      </p>
    </div>
  );
}
