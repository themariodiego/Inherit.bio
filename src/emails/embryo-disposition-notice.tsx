// Sent to every genetic parent when a disposition is recorded for one embryo
// record. It names the embryo by its display label only, states the
// disposition in plain words, and gives the date the record will be deleted.
// Both dates are this embryo's own, never a sibling's; the mail never carries
// a Record Key, an address, a laboratory label or a genetic result.
import { Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export type EmbryoDisposition = "stored" | "transferred" | "donated" | "discarded";

export interface EmbryoDispositionNoticeProps {
  displayLabel: string;
  disposition: EmbryoDisposition;
  /** ISO timestamp of the moment the disposition took effect. */
  effectiveAt: string;
  /** ISO timestamp after which the record is deleted; rendered as a date in words. */
  retentionExpiresAt: string;
}

const paragraph = {
  fontSize: "14px",
  lineHeight: "1.6",
  color: brand.inkMuted,
} as const;

// "5 September 2028": the calendar date in UTC, spelled out so that no
// reader has to parse a timestamp.
function dateInWords(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

// One plain sentence on what the disposition means for this record. Each
// branch is its own literal so the readability gate can score it.
function Meaning({ disposition }: { disposition: EmbryoDisposition }) {
  if (disposition === "stored") {
    return (
      <Text style={paragraph}>
        Stored means the embryo stays in storage. Its record stays on Inherit,
        and any Record Key Card for it still works.
      </Text>
    );
  }
  if (disposition === "transferred") {
    return (
      <Text style={paragraph}>
        Transferred means the embryo was placed for a pregnancy. Earlier Record
        Key Cards for it no longer work, and a replacement card is available
        to each card holder.
      </Text>
    );
  }
  if (disposition === "donated") {
    return (
      <Text style={paragraph}>
        Donated means the embryo was given to someone else. Any Record Key
        Card for it no longer works.
      </Text>
    );
  }
  return (
    <Text style={paragraph}>
      Discarded means the embryo will not be used. Any Record Key Card for it
      no longer works.
    </Text>
  );
}

export function EmbryoDispositionNoticeEmail({
  displayLabel,
  disposition,
  effectiveAt,
  retentionExpiresAt,
}: EmbryoDispositionNoticeProps) {
  return (
    <EmailLayout heading="A change to one embryo record">
      <Text style={paragraph}>
        {displayLabel} was recorded as {disposition} on {dateInWords(effectiveAt)}.
      </Text>
      <Meaning disposition={disposition} />
      <Text style={paragraph}>
        Its record on Inherit will be deleted on {dateInWords(retentionExpiresAt)},
        unless it is withdrawn first.
      </Text>
    </EmailLayout>
  );
}
