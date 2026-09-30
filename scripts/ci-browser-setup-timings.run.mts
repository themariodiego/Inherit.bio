import assert from "node:assert/strict";
import { ciBrowserSourceIdentity } from "./ci-browser-shards-io";
import { writeCiBrowserSetupTimings } from "./ci-browser-setup-timings";

assert(process.argv.length === 4 && /^[1-6]$/.test(process.argv[3]), "Only an actual build timestamp and registered shard are allowed");
writeCiBrowserSetupTimings(process.env, ciBrowserSourceIdentity(), Number(process.argv[3]), Number(process.argv[2]));
