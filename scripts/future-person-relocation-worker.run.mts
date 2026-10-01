/** Operator-started registered subject-object-relocation, TEST-LOCAL only. */
import {preparedWorkerOptions} from "../src/lib/uploads/prepared-worker-options";
const controller=new AbortController(),stop=()=>controller.abort();
process.once("SIGINT",stop);process.once("SIGTERM",stop);
try{
 const options=preparedWorkerOptions(process.argv.slice(2));if(options.metrics)throw new Error("invalid_options");
 const {runFuturePersonRelocationLoop}=await import("../src/lib/future-person/relocation-worker");
 const result=await runFuturePersonRelocationLoop({signal:controller.signal,maximumIterations:options.maximumIterations,
  emit:event=>{process.stdout.write(`${event}\n`);}});
 if(result.hadFailure)process.exitCode=1;
}catch{process.stderr.write("future_person_relocation_unavailable\n");process.exitCode=1;}
finally{controller.abort();process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop);}
