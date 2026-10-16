// Finite qualification of the private TEST statement archive service.
//
//   node --import tsx scripts/requester-statement-archive-qualification.run.mts
//     Dry plan (default): prints the closed case list and the budget proof as
//     JSON. Reads no environment variable and sends no request.
//
//   node --import tsx scripts/requester-statement-archive-qualification.run.mts \
//     --live --receipts=<new file> [--prior-receipt=<earlier receipt>]...
//     Live run against the deployed private gateway. Needs all four
//     INHERIT_TEST_STATEMENT_* gateway variables. Receipts hold counts and
//     fixed labels only; no URL, key, bucket, digest or object key.
//
// Each --prior-receipt from an earlier attempt adds its spent operations and
// unproved stored bytes to the same owner budget.
import { closeSync, ftruncateSync, openSync, readFileSync, writeSync } from "node:fs";
import {
  QualificationRefusal, createSignedGatewayProvider, dryPlanReport, runQualification, selectQualificationMode, sumPriorReceipts,
  type QualificationReceipt,
} from "./requester-statement-archive-qualification";

function refuse(error: unknown): never {
  const refusal = error instanceof QualificationRefusal ? { refused: error.code, names: error.names } : { refused: "qualification_failed" };
  process.stderr.write(`${JSON.stringify(refusal)}\n`);
  process.exit(2);
}

async function main() {
  let mode: ReturnType<typeof selectQualificationMode>;
  let prior: ReturnType<typeof sumPriorReceipts>;
  try {
    mode = selectQualificationMode(process.argv.slice(2), name => process.env[name]);
    prior = sumPriorReceipts(mode.priorReceipts.map(file => readFileSync(file, "utf8")));
  } catch (error) { refuse(error); }

  if (mode.mode === "dry-plan") {
    try { process.stdout.write(`${JSON.stringify(dryPlanReport(prior), null, 2)}\n`); } catch (error) { refuse(error); }
    return;
  }

  let descriptor: number;
  try { descriptor = openSync(mode.receiptsPath, "wx", 0o600); } catch { refuse(new QualificationRefusal("qualification_receipts_path_refused")); }
  const save = (receipt: QualificationReceipt) => {
    const text = `${JSON.stringify(receipt, null, 2)}\n`;
    ftruncateSync(descriptor, 0);
    writeSync(descriptor, text, 0);
  };
  try {
    const provider = createSignedGatewayProvider({ url: mode.url, key: mode.key });
    const result = await runQualification({ provider, configuration: mode.configuration, prior,
      onCase: (done, receipt) => { save(receipt); process.stderr.write(`${done.id} ${done.status}\n`); } });
    save(result.receipt);
    if (result.outstandingObjectKeys.length) {
      // Object keys are random and hold no secret, but they stay out of the receipt.
      const outstanding = openSync(`${mode.receiptsPath}.outstanding.json`, "wx", 0o600);
      writeSync(outstanding, `${JSON.stringify({ outstandingObjectKeys: result.outstandingObjectKeys }, null, 2)}\n`);
      closeSync(outstanding);
    }
    process.stderr.write(`${result.receipt.status} ${result.receipt.ledger.debitedTotal} operations\n`);
    process.exitCode = result.receipt.status === "PASS" ? 0 : 1;
  } catch (error) {
    refuse(error);
  } finally {
    mode.key.fill(0);
    closeSync(descriptor);
  }
}

await main();
