// What the usage card shows, decided from the state main sends (AFT-85). Pure, no DOM, so it is
// unit-tested with plain Node (usageView.test.ts); components/UsageCard only draws what this says.

import type { UsageError, UsageState } from '../usage-screen';

/** A number at or above this is drawn yellow (Aryan, 2026-11-13: blue numbers, big ones yellow). */
export const BIG_NUMBER = 50;

export type Tone = 'ok' | 'warn' | 'crit';

/** The colour of a limit's bar: blue until 75% used, yellow from 75%, red from 90%. */
export function limitTone(percent: number): Tone {
  return percent >= 90 ? 'crit' : percent >= 75 ? 'warn' : 'ok';
}

export function isBigNumber(percent: number): boolean {
  return percent >= BIG_NUMBER;
}

/** 'skeleton' until the first limits arrive, 'failed' when a read ended with none, else 'ready'. */
export function limitsPhase(s: UsageState | null): 'skeleton' | 'ready' | 'failed' {
  if (s && s.usage && s.usage.limits.length > 0) return 'ready';
  if (s && s.status === 'error') return 'failed';
  return 'skeleton';
}

/** The limits a Max plan shows: session, week, week for Fable. */
export const EXPECTED_LIMITS = 3;

/**
 * How many skeleton rows to keep under the limits that have arrived. Claude Code draws the limits
 * one after another, so while a read is running the missing rows stay as skeletons; the card then
 * never shrinks and grows back (Aryan, 2026-11-13). Once the read has finished nothing is held
 * back, so a plan without a Fable line settles at two rows.
 */
export function pendingLimitRows(s: UsageState | null): number {
  if (s && (s.status === 'ready' || s.status === 'error')) return 0;
  const have = s && s.usage ? s.usage.limits.length : 0;
  return Math.max(0, EXPECTED_LIMITS - have);
}

/**
 * The Breakdown tab: 'ready' with its rows, 'skeleton' while it is still being read (it comes a few
 * seconds after the limits), 'none' when a read finished without one (a plan that has none).
 */
export function breakdownPhase(s: UsageState | null): 'skeleton' | 'ready' | 'none' {
  if (s && s.usage && s.usage.breakdown) return 'ready';
  if (!s || s.status === 'idle' || s.status === 'loading') return 'skeleton';
  if (s.usage && s.usage.scanning) return 'skeleton';
  return 'none';
}

/** True while a read is running (the refresh icon spins). */
export function isReading(s: UsageState | null): boolean {
  return !!s && s.status === 'loading';
}

/** The one line shown when nothing could be read. */
export function failText(error: UsageError | null): string {
  return error === 'not-installed' ? 'Claude Code was not found' : "Couldn't read usage";
}
