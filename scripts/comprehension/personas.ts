import { readFileSync } from "node:fs";
import { z } from "zod";

// Closed choices leave no free-text field in which task answers, instructions
// or private participant details can be smuggled into the participant prompt.
const profileSchema = z.object({
  synthetic: z.literal(true),
  age: z.number().int().min(18).max(90),
  firstLanguage: z.enum([
    "Arabic", "Bengali", "Danish", "Dutch", "English", "Farsi", "Finnish",
    "French", "German", "Greek", "Hindi", "Italian", "Mandarin", "Norwegian",
    "Polish", "Portuguese", "Romanian", "Somali", "Spanish", "Swedish", "Tamil",
    "Turkish", "Ukrainian", "Urdu",
  ]),
  englishReading: z.enum(["basic", "comfortable", "fluent"]),
  digitalConfidence: z.enum(["low", "moderate", "high"]),
  background: z.enum([
    "retail assistant", "retired bus driver", "kitchen assistant", "warehouse picker",
    "hotel receptionist", "retired shop assistant", "cafe assistant", "cleaner",
    "delivery driver", "homemaker", "tailor", "shop assistant", "grounds worker",
    "bakery assistant", "bus driver", "retired postal worker", "warehouse packer",
    "ticket seller", "cinema attendant", "laundry assistant", "office clerk",
    "retired factory worker", "restaurant server", "craft seller", "retired cleaner",
    "hotel housekeeper", "freight loader", "market stall worker",
  ]),
  biologyTraining: z.literal("secondary school at most"),
  medicineTraining: z.literal("secondary school at most"),
  statisticsTraining: z.literal("secondary school at most"),
  softwareTraining: z.literal("secondary school at most"),
  projectConnection: z.literal(false),
  priorGenomicsProductExperience: z.literal(false),
}).strict().readonly();

const personaSchema = z.object({
  id: z.string().regex(/^p_[0-9a-f]{12}$/),
  seed: z.number().int().min(1).max(2_147_483_647),
  profile: profileSchema,
}).strict().readonly();

export type Persona = z.infer<typeof personaSchema>;

const personasSchema = z.array(personaSchema).length(30).superRefine((personas, context) => {
  const ids = new Set<string>();
  const seeds = new Set<number>();
  const profiles = new Set<string>();
  personas.forEach((persona, index) => {
    const profile = JSON.stringify(persona.profile);
    if (ids.has(persona.id)) context.addIssue({ code: "custom", path: [index, "id"], message: "Duplicate persona id" });
    if (seeds.has(persona.seed)) context.addIssue({ code: "custom", path: [index, "seed"], message: "Duplicate persona seed" });
    if (profiles.has(profile)) context.addIssue({ code: "custom", path: [index, "profile"], message: "Duplicate persona profile" });
    ids.add(persona.id);
    seeds.add(persona.seed);
    profiles.add(profile);
  });
}).readonly();

const bankSchema = z.object({
  schemaVersion: z.literal(1),
  personas: personasSchema,
}).strict();

/** Read committed synthetic profiles; never generate or select them by results. */
export function loadPersonas(filename: string | URL = new URL("./personas.json", import.meta.url)): readonly Persona[] {
  return bankSchema.parse(JSON.parse(readFileSync(filename, "utf8"))).personas;
}

/** The conductor supplies task and visible page observations separately.
 * This function has no access to bindings, grading rules, other profiles or
 * earlier runs. Process and browser isolation remain the conductor's job.
 */
export function participantPersonaPrompt(persona: Persona): string {
  const selected = personaSchema.parse(persona);
  return "You are a synthetic participant in a usability exercise, not a real person. "
    + "Act as the participant described below. Use only the task and visible page information supplied in this session."
    + "\n\n" + JSON.stringify(selected, null, 2);
}
