import { uploadSignerPublicJwk } from "@/lib/uploads/storage-upload-token";

/** The upload signer's public verification keys, for the prepared-artifact
 * gateway's `SIGNING_PUBLIC_KEYS` binding (`workers/prepared-artifacts`). A
 * public key is not a secret; the private member never leaves the signer, and
 * a deployment without a usable signer answers 503 rather than an empty set. */
export function GET() {
  try {
    return Response.json({ keys: [uploadSignerPublicJwk()] }, {
      headers: { "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" },
    });
  } catch {
    return Response.json({ error: "unavailable" }, {
      status: 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
}
