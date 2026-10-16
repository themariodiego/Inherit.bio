// The register's upload-time notice for another adult's file (Path B,
// upload-time-rights-notice-v1, TEST-LOCAL only). Queued in the same commit
// as the held file and sent to the address the person's own record holds.
// It says what was stored and what was not, the closed list of what can be
// made from the file (the same ADULT_UPLOAD_DERIVED_LIST the review page
// renders), the fixed deletion date, the 730-day maximum for a file confirmed
// with no account (adult.non-account-holder-24mo), and gives one link, with no account, to
// see what the uploader sees and to say yes, say no, or delete everything.
// Only the uploader's safe account display name is shown; no recipient
// address, file name or genetic value is carried.
import { Button, Text } from "@react-email/components";
import { ADULT_UPLOAD_DERIVED_LIST as DERIVED, ADULT_UPLOAD_REVISION_COPY as REVISION } from "@/copy/upload/other-adult";
import { ADULT_NON_ACCOUNT_HOLDER_KEEP_DAYS } from "@/lib/uploads/other-adult-upload";
import { EmailLayout, brand } from "./base";

export interface AdultUploadNoticeProps {
  fileKind: "array" | "vcf";
  /** Captured by the native upload notice; absent on older queued notices. */
  uploaderName?: string | null;
  /** The UTC day the file was added, as an ISO date. */
  uploadedOn: string;
  /** The fixed UTC day the file is deleted unless the person says yes. */
  deleteBy: string;
  /** Built server-side from the delivery token. */
  reviewUrl: string;
}

const paragraph = { fontSize: "14px", lineHeight: "1.6", color: brand.inkMuted } as const;
const derivedHeading = { ...paragraph, color: brand.ink, fontWeight: 600, margin: "16px 0 4px" } as const;
const derivedList = { ...paragraph, margin: "0 0 8px", paddingLeft: "20px" } as const;
const derivedItem = { margin: "0 0 4px" } as const;

const button = {
  backgroundColor: brand.forest,
  color: brand.paper,
  padding: "10px 20px",
  borderRadius: "9999px",
  textDecoration: "none",
};

function words(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function AdultUploadNoticeEmail({ fileKind, uploaderName, uploadedOn, deleteBy, reviewUrl }: AdultUploadNoticeProps) {
  return (
    <EmailLayout heading="A DNA file was added for you">
      <Text style={paragraph}>
        On {words(uploadedOn)}, the person you gave permission to added a DNA
        file for you on Inherit. It is {fileKind === "array" ? "a raw data file" : "a VCF file"}.
      </Text>
      <Text style={paragraph}>
        Who added it: {uploaderName ?? "Someone with an Inherit account"}.
        {uploaderName ? " This is the name on their account." : ""}
      </Text>
      <Text style={paragraph}>
        Nothing is made from it unless you say yes.
      </Text>
      <Text style={derivedHeading}>{DERIVED.heading}</Text>
      <ul style={derivedList}>
        {DERIVED.items.map(item => <li key={item.category} style={derivedItem}>{item.text}</li>)}
      </ul>
      <Text style={paragraph}>{DERIVED.closing}</Text>
      <Text style={paragraph}>
        If you do nothing, it is deleted on {words(deleteBy)}, 30 days after it
        was added.
      </Text>
      <Text style={paragraph}>{REVISION.noticeKeep(ADULT_NON_ACCOUNT_HOLDER_KEEP_DAYS)}</Text>
      <Text style={paragraph}>
        You do not need an account. The link shows what they can see, and lets
        you say yes, say no, or delete everything.
      </Text>
      <Button href={reviewUrl} style={button}>Review the file</Button>
      <Text style={paragraph}>
        If the link does not work, or you did not expect this, write to privacy@inherit.bio.
      </Text>
    </EmailLayout>
  );
}
