// The bundled PRS seed data (license-checked per score; see
// docs/dataset-licenses.md and each file's license_note).
import pgs000011 from "../../../data/prs/PGS000011.json";
import pgs000115 from "../../../data/prs/PGS000115.json";
import pgs004602 from "../../../data/prs/PGS004602.json";
import type { PrsScore } from "./prs";

export const ALL_PRS_SCORES = [
  pgs000011,
  pgs000115,
  pgs004602,
] as unknown as PrsScore[];
