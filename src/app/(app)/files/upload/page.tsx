import type { Metadata } from "next";
import Link from "next/link";
import { Uploader } from "@/components/uploads/uploader";

export const metadata: Metadata = { title: "Add a file" };

export default function FileUploadPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">Files</p>
        <h1 className="display text-3xl">Add your genome file</h1>
        <p className="text-base leading-relaxed text-ink-muted">
          You can add only your own genome here. Family and embryo uploads stay
          off until their separate consent and legal rules are met.
        </p>
      </header>
      <Uploader />
      <p className="text-sm">
        <Link href="/files" className="underline underline-offset-2">← All files</Link>
      </p>
    </div>
  );
}
