// Shared layout for all Inherit transactional emails, in the brand:
// paper ground, ink text, forest accent. System font fallbacks only —
// webfonts are unreliable in email clients.
import {
  Body,
  Container,
  Head,
  Html,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

export const brand = {
  paper: "#F7F8F1",
  ink: "#14201B",
  inkMuted: "#4C5A52",
  forest: "#2E5C45",
  border: "#DDE2D3",
} as const;

export const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

const footerText = {
  fontSize: "12px",
  lineHeight: "1.5",
  color: brand.inkMuted,
  margin: "0 0 4px",
} as const;

export function EmailLayout({
  heading,
  children,
  unsubscribe,
}: {
  heading: string;
  children: ReactNode;
  /** Optional footer slot for an unsubscribe / manage-preferences link. */
  unsubscribe?: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head />
      <Body
        style={{
          margin: 0,
          backgroundColor: brand.paper,
          color: brand.ink,
          fontFamily: fontStack,
          padding: "24px",
        }}
      >
        <Container style={{ maxWidth: "520px" }}>
          <Text
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontSize: "22px",
              letterSpacing: "-0.5px",
              color: brand.ink,
              margin: "0 0 16px",
            }}
          >
            In<span style={{ color: brand.forest }}>herit.</span>
          </Text>
          <Section
            style={{
              backgroundColor: "#ffffff",
              border: `1px solid ${brand.border}`,
              borderRadius: "16px",
              padding: "24px",
            }}
          >
            <Text
              style={{
                fontFamily: "Georgia, 'Times New Roman', serif",
                fontSize: "22px",
                fontWeight: 400,
                margin: "0 0 12px",
              }}
            >
              {heading}
            </Text>
            {children}
          </Section>
          <Section style={{ paddingTop: "16px" }}>
            <Text style={footerText}>
              Inherit · an open-source project created by Plus Bio for the public good
            </Text>
            <Text style={footerText}>Informational, not medical advice.</Text>
            {unsubscribe}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
