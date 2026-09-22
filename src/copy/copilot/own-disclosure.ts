/** Named information in the current own-Copilot permission presentation.
 * Other Copilot scopes keep their existing separate disclosure. */
export const OWN_COPILOT_DATA_CLASSES = [
  "Individual genotypes you ask about (rsID, genotype)",
  "Variant search results (gene, position, genotype)",
  "Report titles, interpretations and coverage states, including saved ancestry estimates and lineage results",
  "Score-panel coverage and why a validated score is unavailable",
  "Your chat messages",
] as const;
