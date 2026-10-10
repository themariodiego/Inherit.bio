/** Explicit TEST-only private account archive disposal. No caller target,
 * automatic replay, production activation or provider response is printed. */
import {runTestAccountArchiveDisposal} from "../src/lib/exports/account-archive-test-disposal";
const stop=new AbortController(),cancel=()=>stop.abort();
process.once("SIGINT",cancel);process.once("SIGTERM",cancel);
try{
 if(process.argv.length!==3||process.argv[2]!=="--test-r2-once")throw new Error("worker_closed");
 await runTestAccountArchiveDisposal({signal:stop.signal});
 process.stdout.write("account_export_disposal_drained\n");
}catch{process.stderr.write("account_export_disposal_unavailable\n");process.exitCode=1;}
finally{stop.abort();process.removeListener("SIGINT",cancel);process.removeListener("SIGTERM",cancel);}
