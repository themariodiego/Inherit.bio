import assert from "node:assert/strict";
import { startPreparedArtifactFixture } from "./prepared-artifact-fixture";
import { startEmbryoBrowserFragmentFixture } from "./embryo-browser-fragment-fixture";
import { createPreparedArtifactProofWriter } from "./prepared-artifact-proof";

/** Prepared proof has one exclusive live writer. The Embryo fixture owns its
 * separate gateway and must never create or replace that prepared proof. */
export async function startCiArtifactGateway(port: number, input: {
  publicJwk: Record<string, unknown>; key: Buffer; cert: Buffer;
}) {
  assert(port === 3104 || port === 3105, "Exact artifact app variant required");
  return port === 3104
    ? startPreparedArtifactFixture({ ...input, onChange: createPreparedArtifactProofWriter() })
    : startEmbryoBrowserFragmentFixture(input);
}
