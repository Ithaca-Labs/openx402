/** Frozen Step 4 assignment policy shared by prompt generation and merge validation. */

import { RELEASE_COUNTS } from "./schema/schema-v2.js";

/** MVP scope cut: 4 agents x 100 records (400 total), not 9 waves x 10 x 10 (900). One wave. */
export const DISTRACTOR_WAVES = 1;
export const DISTRACTOR_AGENTS_PER_WAVE = 4;
export const DISTRACTOR_RECORDS_PER_SHARD = 100;
export const FIRST_DISTRACTOR_NUMBER = 101;
export const LAST_DISTRACTOR_NUMBER = 500;
/** ~1% upto-bearing, matching DISTRIBUTION_TARGETS.distractor_upto_max_fraction (4/400). */
export const DISTRACTOR_UPTO_NUMBERS = [147, 189, 358, 416] as const;

export function padNumber(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function distractorResourceId(resourceNumber: number): string {
  return `res-${padNumber(resourceNumber, 4)}`;
}

export function distractorProviderId(resourceNumber: number): string {
  return `provider-${padNumber(((resourceNumber - 1) % RELEASE_COUNTS.providers) + 1, 3)}`;
}

export function distractorAssignment(resourceNumber: number): {
  wave: number;
  agent: number;
  providerId: string;
  runId: string;
  shardId: string;
} {
  if (
    !Number.isInteger(resourceNumber) ||
    resourceNumber < FIRST_DISTRACTOR_NUMBER ||
    resourceNumber > LAST_DISTRACTOR_NUMBER
  ) {
    throw new Error(`distractor resource number out of range: ${resourceNumber}`);
  }

  const globalShard = Math.floor(
    (resourceNumber - FIRST_DISTRACTOR_NUMBER) / DISTRACTOR_RECORDS_PER_SHARD,
  ) + 1;
  const wave = Math.floor((globalShard - 1) / DISTRACTOR_AGENTS_PER_WAVE) + 1;
  const agent = ((globalShard - 1) % DISTRACTOR_AGENTS_PER_WAVE) + 1;
  const suffix = `w${padNumber(wave, 2)}-a${padNumber(agent, 2)}`;
  return {
    wave,
    agent,
    providerId: distractorProviderId(resourceNumber),
    runId: `run-distractors-${suffix}`,
    shardId: `shard-distractors-${suffix}`,
  };
}
