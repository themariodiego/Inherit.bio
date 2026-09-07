import { cleanupCiBrowserRuntime, recordCiBuild } from "./ci-browser-runtime";
if (process.argv[2] === "record-build") recordCiBuild();
else if (process.argv[2] === "cleanup") cleanupCiBrowserRuntime();
else throw new Error("Only record-build and cleanup are accepted");
