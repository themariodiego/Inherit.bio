import { fleschKincaid } from "flesch-kincaid";
import { syllable } from "syllable";

const PLACEHOLDER = "fact";
const OPAQUE_PATTERNS = [
  /\brs\d+\b/gi,
  /\b(?:chr)?(?:[1-9]|1\d|2[0-2]|x|y|mt)(?::\d+(?:-\d+)?)?\b/gi,
  /\b[A-Z][A-Z0-9-]{1,11}\b/g,
  /\b\d+(?:[.,]\d+)?(?:e[+-]?\d+)?%?\b/gi,
  /\b(?:bp|kb|mb|gb|mg|g|kg|mcg|ml|cm|mm|nm|hz|kbps)\b/gi,
  /\b[a-f0-9]{32,}\b/gi,
];

export interface ReadabilityCounts {
  [key: string]: number;
  sentence: number;
  word: number;
  syllable: number;
}

export function normalizeForReadability(value: string): string {
  let normalized = value
    .normalize("NFKC")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, ` ${PLACEHOLDER} `)
    .replace(/[\u2013\u2014]/g, " — ");
  for (const pattern of OPAQUE_PATTERNS) {
    normalized = normalized.replace(pattern, ` ${PLACEHOLDER} `);
  }
  return normalized.replace(/\s+/g, " ").trim();
}

export function readabilityWords(value: string): string[] {
  return normalizeForReadability(value).match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? [];
}

export function readabilitySentences(value: string): string[] {
  const normalized = normalizeForReadability(value);
  if (!normalized) return [];
  const sentences = normalized
    .split(/(?<=[.!?])(?:["'”’)]*)\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => readabilityWords(sentence).length > 0);
  return sentences.length > 0 ? sentences : [normalized];
}

export function readabilityCounts(value: string): ReadabilityCounts {
  const words = readabilityWords(value);
  return {
    sentence: Math.max(readabilitySentences(value).length, 1),
    word: words.length,
    syllable: words.reduce((total, word) => total + syllable(word), 0),
  };
}

export function fleschKincaidGrade(value: string): number {
  const counts = readabilityCounts(value);
  if (counts.word === 0) return 0;
  return fleschKincaid(counts);
}

export function wordCount(value: string): number {
  return readabilityWords(value).length;
}
