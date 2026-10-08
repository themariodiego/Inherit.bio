import type { Metadata } from "next";
import Link from "next/link";
import { OwnUploadEntry } from "@/components/uploads/own-upload-entry";
import { OtherAdultUploadSection } from "@/components/uploads/other-adult-upload-section";
import { route } from "@/lib/primary-routes";

export const metadata: Metadata = { title: "Add a file" };

export default function FileUploadPage() {
  return (
    <div className="page-stack rec-column stack-sections">
      <header className="rec-head">
        <p className="eyebrow">Files</p>
        <h1 className="display">Add your genome file</h1>
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
