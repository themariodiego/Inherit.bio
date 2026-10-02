// The upload-time rights notice (register upload-time-rights-notice-v1.embryo),
// sent to each genetic parent other than the uploader when an embryo set's
// records are published. It says who added them and when, in which capacity,
// exactly what was stored and what was not, what may be worked out from them,
// the longest they are kept, and where to write if the link fails. The
// withdraw link is present only when the mail worker built one from a
// delivery token: only a parent who may decide what happens to the embryos
// gets one, and it opens a read-only view of what the uploader can see with
// the withdrawal actions, no account needed. The mail never carries an
// another person's address, a Record Key, an embryo's result or a laboratory label.
import { Button, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

const EMBRYO_NOTICE_CONTACT = "privacy@inherit.bio";

export interface EmbryoUploadNoticeProps {
  embryoCount: number;
  /** The uploader's own display name when it is plain words; otherwise absent. */
  uploaderName: string | null;
  uploadedBy: "genetic-parent" | "someone-else";
  uploadDateIso: string;
  uploadDateWords: string;
  /** The retention maximum, in days from the day they were added. */
  retentionDays: number;
  /** Built server-side from the delivery token; absent when the reader has no withdraw link. */
  withdrawUrl?: string;
}

const paragraph = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: brand.inkMuted,
} as const;

const button = {
  backgroundColor: brand.forest,
  color: brand.paper,
  padding: "10px 20px",
  borderRadius: "9999px",
  textDecoration: "none",
};

export function EmbryoUploadNoticeEmail(props: EmbryoUploadNoticeProps) {
  const records = props.embryoCount === 1 ? "1 embryo record" : `${props.embryoCount} embryo records`;
  const verb = props.embryoCount === 1 ? "was" : "were";
  const who = props.uploaderName ?? "Someone with an Inherit account";
  const capacity = props.uploadedBy === "genetic-parent"
    ? "as a genetic parent"
    : "without being a genetic parent, under the agreement on record";
  const on = `${props.uploadDateWords} (${props.uploadDateIso})`;
  return (
    <EmailLayout heading="Embryos were added to Inherit">
      <Text style={paragraph}>
        On {on}, {records} {verb} added on Inherit to a set of embryos that
        names you as a genetic parent.
      </Text>
      <Text style={paragraph}>
        Who added them: {who}, {capacity}.
      </Text>
      <Text style={paragraph}>
        What was stored: {records}, added on {on}.
      </Text>
      <Text style={paragraph}>
        What was not stored: no results, and no laboratory labels.
      </Text>
      <Text style={paragraph}>
        What Inherit may work out from them: a quality check of each embryo&apos;s
        file. Nothing else is worked out today.
      </Text>
      <Text style={paragraph}>
        How long they are kept: Inherit deletes them at most{" "}
        {props.retentionDays} days after they were added, unless they are
        renewed.
      </Text>
      {props.withdrawUrl ? (
        <>
          <Text style={paragraph}>
            The link below shows you what the person who added them can see,
            and nothing more. From there you can withdraw at any time, without
            an account. Withdrawing deletes these records and stops any
            analysis of them.
          </Text>
          <Button href={props.withdrawUrl} style={button}>Review your options</Button>
        </>
      ) : null}
      <Text style={paragraph}>
        {props.withdrawUrl ? "If the link does not work, or you did not expect this," : "If you did not expect this,"}{" "}
        write to {EMBRYO_NOTICE_CONTACT}.
      </Text>
    </EmailLayout>
  );
}
