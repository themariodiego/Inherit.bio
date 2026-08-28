// Monthly digest of newly published reports. Contains only public
// template info (titles, summaries, links) — never recipient data.
import { Link, Section, Text } from "@react-email/components";
import { EmailLayout, brand } from "./base";

export interface DigestEntry {
  title: string;
  summary: string;
  url: string;
}

export interface ResearchDigestProps {
  entries: DigestEntry[];
  manageUrl: string;
}

export function ResearchDigestEmail({
  entries,
  manageUrl,
}: ResearchDigestProps) {
  return (
    <EmailLayout
      heading="New in the Sequence research library"
      unsubscribe={
        <Text style={{ fontSize: "12px", margin: 0 }}>
          <Link href={manageUrl} style={{ color: brand.inkMuted }}>
            Manage email preferences
          </Link>
        </Text>
      }
    >
      <Text
        style={{
          fontSize: "14px",
          lineHeight: "1.6",
          color: brand.inkMuted,
          margin: "0 0 8px",
        }}
      >
        New report{entries.length === 1 ? "" : "s"} published this month:
      </Text>
      {entries.map((entry) => (
        <Section
          key={entry.url}
          style={{ borderTop: `1px solid ${brand.border}`, padding: "12px 0" }}
        >
          <Link
            href={entry.url}
            style={{
              color: brand.forest,
              textDecoration: "none",
              fontSize: "15px",
              fontWeight: 600,
            }}
          >
            {entry.title}
          </Link>
          <Text
            style={{
              fontSize: "13px",
              lineHeight: "1.5",
              color: brand.inkMuted,
              margin: "4px 0 0",
            }}
          >
            {entry.summary}
          </Text>
        </Section>
      ))}
    </EmailLayout>
  );
}
