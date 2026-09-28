// The register's upload-time notice for another adult's file (Path B,
// upload-time-rights-notice-v1, TEST-LOCAL only). Queued in the same commit
// as the held file and sent to the address the person's own record holds.
// It says what was stored and what was not, the fixed deletion date, and
// gives one link, with no account, to see what the uploader sees and to say
// yes, say no, or delete everything. It never carries a name, an address, a
// file name or anything read from the file.
import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface AdultUploadNoticeProps {
  fileKind: "array" | "vcf";
  /** The UTC day the file was added, as an ISO date. */
  uploadedOn: string;
  /** The fixed UTC day the file is deleted unless the person says yes. */
  deleteBy: string;
  /** Built server-side from the delivery token. */
  reviewUrl: string;
}

const paragraph = { fontSize: "14px", lineHeight: "1.6", color: brand.inkMuted } as const;

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

export function AdultUploadNoticeEmail({ fileKind, uploadedOn, deleteBy, reviewUrl }: AdultUploadNoticeProps) {
  return (
    <EmailLayout heading="A DNA file was added for you">
      <Text style={paragraph}>
        On {words(uploadedOn)}, the person you gave permission to added a DNA
        file for you on Inherit. It is {fileKind === "array" ? "a raw data file" : "a VCF file"}.
      </Text>
      <Text style={paragraph}>
        Nothing is made from it unless you say yes. Even then, Inherit asks
        you first, one purpose at a time.
      </Text>
      <Text style={paragraph}>
        If you do nothing, it is deleted on {words(deleteBy)}, 30 days after it
        was added.
      </Text>
      <Text style={paragraph}>
        You do not need an account. The link shows what they can see, and lets
        you say yes, say no, or delete everything.
      </Text>
      <Button href={reviewUrl} style={button}>Review the file</Button>
    </EmailLayout>
  );
}
