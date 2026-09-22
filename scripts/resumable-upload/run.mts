import { PREVIEW_APP, PREVIEW_PROJECT, validateTarget } from "./contract";
import { createReceiptWriter, readCredentials } from "./io";
import { probeEmptyUpload } from "./probe";
import { probeExitStatus } from "./receipt";

// Arguments are protected file paths and the explicit opt-in, never credentials.
const [credentialFile, receiptFile, optIn, ...extra] = process.argv.slice(2);
try {
  validateTarget(PREVIEW_PROJECT, PREVIEW_APP, optIn);
  if (!credentialFile || !receiptFile || extra.length) throw new Error("probe_contract_refused");
  const credentials = await readCredentials(credentialFile, Date.now());
  const writer = await createReceiptWriter(receiptFile);
  try {
    const receipt = await probeEmptyUpload({ project: PREVIEW_PROJECT, appOrigin: PREVIEW_APP, optIn, credentials },
      { fetch, save: writer.save });
    process.exitCode = probeExitStatus(receipt);
  } finally { await writer.close(); }
} catch {
  process.stderr.write("probe_stopped; inspect the protected sanitized receipt if one was created\n");
  process.exitCode = 1;
}
