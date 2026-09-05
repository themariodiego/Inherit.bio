export interface EmbryoInputFacts {
  coordinate_conversion: "not-recorded" | "converted" | "not-needed" | "mixed";
  source_origin: "external-unverified";
  source_imputation: "not-recorded";
  call_observation: "not-recorded";
}

export const UNKNOWN_EMBRYO_INPUT: EmbryoInputFacts = {
  coordinate_conversion: "not-recorded", source_origin: "external-unverified",
  source_imputation: "not-recorded", call_observation: "not-recorded",
};
