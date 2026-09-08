import type { OwnUploadArtifactKey } from "./own-consent";

export type OwnUploadArtifactView = {
  key: OwnUploadArtifactKey;
  version: number;
  summary: string;
  body: string;
};

export type OwnUploadView =
  | { kind: "unavailable" }
  | { kind: "underage" }
  | { kind: "account-completion"; token: string }
  | { kind: "consent"; token: string; subjectId: string; artifact: OwnUploadArtifactView }
  | { kind: "ready"; subjectId: string };
