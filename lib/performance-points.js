// Shared formula for "performance points" (PP) earned on each correct buzz.
// Imported by both the client (browser) and the server (Node).
//
//   PP = base × diffMult × roundMult × celerityFactor
//
// Components:
//   base            100
//   diffMult        Novice 0.6 · Intermediate 1.0 · Advanced 1.5
//   roundMult       Round 1.00 → Finals 1.50 (parsed from packet name)
//   celerityFactor  0.4 + 1.6 × celerity^1.5  (range 0.4 → 2.0)
//
// Wrong buzzes and dead questions earn 0 PP.

const BASE = 100;

const DIFFICULTY_MULTIPLIERS = {
  // numeric set.difficulty (1..10)
  1: 0.55, 2: 0.6, 3: 0.7,
  4: 0.85, 5: 1.0, 6: 1.15,
  7: 1.3, 8: 1.4, 9: 1.5, 10: 1.6,
  // string fallback
  novice: 0.6,
  intermediate: 1.0,
  advanced: 1.5,
  elite: 1.6
};

const ROUND_MULTIPLIERS = [
  // Order matters — first regex match wins.
  [/finals?/i,                                   1.50],
  [/semi[\s-]?finals?/i,                         1.30],
  [/quarter[\s-]?finals?/i,                      1.20],
  [/wild ?card|consolation|playoff/i,            1.15],
  [/round\s*(\d+)|^r(\d+)\b|round one|round 1/i, 1.00] // any "round" → 1.0 by default
];

/** Map a tossup's set difficulty to a multiplier. Falls back to 1.0. */
export function difficultyMultiplier (difficulty) {
  if (difficulty == null) return 1.0;
  const key = typeof difficulty === 'string'
    ? difficulty.trim().toLowerCase()
    : Number(difficulty);
  return DIFFICULTY_MULTIPLIERS[key] ?? 1.0;
}

/** Map a packet/round label to a multiplier. Round numbers ramp 1.00 → 1.10. */
export function roundMultiplier (packetName) {
  const s = String(packetName || '').trim();
  if (!s) return 1.0;

  for (const [re, mult] of ROUND_MULTIPLIERS) {
    if (re.test(s)) {
      // For numbered rounds, give a small ramp: R1=1.0, R2=1.05, R3=1.10, …
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
 * Celerity factor: rewards earlier buzzes super-linearly.
 *   celerity 1.0 → 2.0   (buzzed before any text shown)
 *   celerity 0.5 → 0.97
 *   celerity 0.0 → 0.40  (buzzed at last word)
 */
export function celerityFactor (celerity) {
  const c = Math.max(0, Math.min(1, Number(celerity) || 0));
  return 0.4 + 1.6 * Math.pow(c, 1.5);
}

/**
 * Compute PP for a single buzz. Returns 0 for incorrect/dead.
 *
 * @param {Object}  args
 * @param {boolean} args.isCorrect
 * @param {number}  args.celerity        0..1 (fraction of question still unread when you buzzed)
 * @param {number|string} args.difficulty Set difficulty (1..10) or label
 * @param {string=} args.packetName       e.g. "Round 1", "Finals"
 * @returns {number}                      Whole-number PP, 0 for incorrect/dead.
 */
export function computePP ({ isCorrect, celerity, difficulty, packetName } = {}) {
  if (!isCorrect) return 0;
  const pp = BASE *
    difficultyMultiplier(difficulty) *
    roundMultiplier(packetName) *
    celerityFactor(celerity);
  return Math.max(0, Math.round(pp));
}

export const PP_BASE = BASE;
