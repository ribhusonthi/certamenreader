// Performance-points formulas — server-only (this file lives outside ./client
// and is not exposed to browsers). Modeled after osu!'s "weighted top 100":
//
//   raw_pp_per_buzz = base × diffMult × roundMult × celerityFactor
//
//   total_pp = Σ_{i=1..100} pp_i × 0.95^(i-1)   +   activity_bonus
//
//   activity_bonus = 416.667 × (1 − 0.9994^total_correct_buzzes)
//                    (caps at ~417 — rewards activity but never dominates)
//
// Only your best 100 buzzes contribute to the weighted sum. Your #1 play
// counts at 100%, #50 at ~8%, #100 at ~0.6%. Sum of weights → ≈ 19.88.
// With a max raw per-buzz around 500 PP, total caps near ~10 000 PP.

const BASE = 100;

// Pull harder questions further from the easy ones.
const DIFFICULTY_MULTIPLIERS = {
  // numeric set.difficulty (1..10)
  1: 0.45,
  2: 0.5,
  3: 0.6,
  4: 0.8,
  5: 1.0,
  6: 1.25,
  7: 1.5,
  8: 1.7,
  9: 1.85,
  10: 2.0,
  // string fallback
  novice: 0.5,
  intermediate: 1.0,
  advanced: 1.8,
  elite: 2.0
};

const ROUND_MULTIPLIERS = [
  // First regex match wins.
  [/finals?/i, 1.50],
  [/semi[\s-]?finals?/i, 1.30],
  [/quarter[\s-]?finals?/i, 1.20],
  [/wild ?card|consolation|playoff/i, 1.15],
  [/round\s*(\d+)|^r(\d+)\b|round one|round 1/i, 1.00]
];

/** Difficulty multiplier; falls back to 1.0 when unknown. */
export function difficultyMultiplier (difficulty) {
  if (difficulty == null) return 1.0;
  const key = typeof difficulty === 'string'
    ? difficulty.trim().toLowerCase()
    : Number(difficulty);
  return DIFFICULTY_MULTIPLIERS[key] ?? 1.0;
}

/** Round multiplier; numbered rounds ramp 1.00 → 1.20. */
export function roundMultiplier (packetName) {
  const s = String(packetName || '').trim();
  if (!s) return 1.0;
  for (const [re, mult] of ROUND_MULTIPLIERS) {
    if (re.test(s)) {
      const m = s.match(/round\s*(\d+)|^r(\d+)\b|^packet\s*(\d+)/i);
      if (m && (m[1] || m[2] || m[3])) {
        const n = parseInt(m[1] || m[2] || m[3], 10);
        if (Number.isFinite(n) && n >= 1) {
          return Math.min(1.20, 1.0 + (n - 1) * 0.05);
        }
      }
      return mult;
    }
  }
  return 1.0;
}

/**
 * Celerity factor — much steeper than before so very early buzzes are heavily
 * rewarded.
 *   celerity 1.00 → 2.00
 *   celerity 0.80 → 1.46
 *   celerity 0.50 → 0.79
 *   celerity 0.20 → 0.40
 *   celerity 0.00 → 0.30
 */
export function celerityFactor (celerity) {
  const c = Math.max(0, Math.min(1, Number(celerity) || 0));
  return 0.3 + 1.7 * Math.pow(c, 1.8);
}

/**
 * Raw PP earned on a single buzz. 0 for incorrect / dead.
 */
export function computePP ({ isCorrect, celerity, difficulty, packetName } = {}) {
  if (!isCorrect) return 0;
  const pp = BASE *
    difficultyMultiplier(difficulty) *
    roundMultiplier(packetName) *
    celerityFactor(celerity);
  return Math.max(0, Math.round(pp));
}

// ── osu-style weighted total ────────────────────────────────────────────────

const TOP_N = 100;
const WEIGHT_DECAY = 0.95; // each rank drops the contribution by 5 %
const ACTIVITY_CAP = 416.667;
const ACTIVITY_DECAY = 0.9994;

/**
 * Weighted sum of an array of per-buzz PP values.
 * Sorts the array descending (does not mutate the input), keeps the top 100,
 * then sums pp_i × 0.95^(i-1).
 *
 * @param {number[]} ppList  Per-buzz PP values (any order).
 * @returns {number}         Weighted PP, rounded to whole number.
 */
export function weightedTopSum (ppList) {
  if (!Array.isArray(ppList) || ppList.length === 0) return 0;
  const sorted = ppList
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a)
    .slice(0, TOP_N);
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    sum += sorted[i] * Math.pow(WEIGHT_DECAY, i);
  }
  return Math.round(sum);
}

/**
 * Activity bonus — saturates near 417 so very active players get a small
 * boost without it dwarfing the top-100 weighted total.
 */
export function activityBonus (totalCorrectBuzzes) {
  const n = Math.max(0, Number(totalCorrectBuzzes) || 0);
  return Math.round(ACTIVITY_CAP * (1 - Math.pow(ACTIVITY_DECAY, n)));
}

/** Total PP shown on profiles & leaderboards. */
export function totalPP (ppList, totalCorrectBuzzes) {
  return weightedTopSum(ppList) + activityBonus(totalCorrectBuzzes);
}

export const PP_BASE = BASE;
export const PP_TOP_N = TOP_N;
export const PP_WEIGHT_DECAY = WEIGHT_DECAY;
