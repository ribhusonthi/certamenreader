// Questions have no round field, so a question's round is read off its packet
// name, which sets spell inconsistently: "ROUND ONE", "Round 1", "ROUND I",
// "PRELIMINARY ROUND 3", "SEMIFINAL ROUND", "FINALS". Sets imported as a
// single "Packet 1" carry no round and drop out whenever a round is selected.
//
// Shared by the readers (client-side filtering while reading a set) and the
// database queries (a $regex on packet.name), so the two can't drift apart.
// The patterns use only syntax JavaScript and MongoDB's PCRE agree on.
const ROUND_PATTERNS = {
  'Round 1': '\\bround\\s+(?:1|one|i)\\b',
  'Round 2': '\\bround\\s+(?:2|two|ii)\\b',
  'Round 3': '\\bround\\s+(?:3|three|iii)\\b',
  Semifinals: '\\bsemi-?finals?\\b',
  // \b already keeps "SEMIFINAL" out; the lookbehind handles "SEMI-FINAL".
  Finals: '(?<!semi-)\\bfinals?\\b'
};

const ROUNDS = Object.keys(ROUND_PATTERNS);

const ANY_ROUND = ROUNDS.map(round => `(?:${ROUND_PATTERNS[round]})`).join('|');

/**
 * Keep only known round names. Accepts an array or a comma-separated string,
 * so it doubles as the query-string parser on the server.
 * @param {string[] | string | undefined} rounds
 * @returns {string[]}
 */
function sanitizeRounds (rounds) {
  if (typeof rounds === 'string') rounds = rounds.split(',');
  if (!Array.isArray(rounds)) return [];
  return [...new Set(rounds.map(r => String(r).trim()))].filter(r => ROUNDS.includes(r));
}

/**
 * @param {string[]} rounds
 * @returns {string | null} a case-insensitive pattern matching any of the given rounds, or null for "any round".
 */
function roundsPattern (rounds) {
  rounds = sanitizeRounds(rounds);
  if (rounds.length === 0) return null;
  const wanted = rounds.map(round => `(?:${ROUND_PATTERNS[round]})`).join('|');
  // Only the first round the name mentions counts: some parsed names run on
  // into the next packet's header ("ROUND 1 VISUAL … PRELIMINARY ROUND 2").
  return `^(?:(?!${ANY_ROUND})[\\s\\S])*(?:${wanted})`;
}

/**
 * @param {string[]} rounds
 * @returns {Object | null} a MongoDB condition for `packet.name`, or null for "any round".
 */
function roundsFilter (rounds) {
  const pattern = roundsPattern(rounds);
  return pattern ? { $regex: pattern, $options: 'i' } : null;
}

/**
 * @param {string | undefined} packetName
 * @param {string[]} rounds
 * @returns {boolean} whether the packet belongs to one of the given rounds. An empty list matches everything.
 */
function packetMatchesRounds (packetName, rounds) {
  const pattern = roundsPattern(rounds);
  if (!pattern) return true;
  return new RegExp(pattern, 'i').test(packetName ?? '');
}

/**
 * @param {string | undefined} packetName
 * @returns {string | null} the first round the packet name mentions, or null.
 */
function roundOf (packetName) {
  return ROUNDS.find(round => packetMatchesRounds(packetName, [round])) ?? null;
}

const toTitleCase = (string) => string.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

/**
 * A packet is a round of a tournament; this is the name the UI shows for it.
 * Stored names are raw document headers ("ROUND ONE", "SEMIFINAL ROUND"),
 * sometimes with a second header glued on, and packets imported without a
 * header are named "Packet N".
 * @param {{ name?: string, number?: number } | undefined} packet
 * @returns {string} e.g. "Round 1", "Finals", "Round 2 Extras", "Tiebreakers"
 */
function roundLabel (packet) {
  const name = packet?.name ?? '';
  const round = roundOf(name);
  if (round) {
    return /\bextra/i.test(name.split('\n')[0]) ? `${round} Extras` : round;
  }

  const firstLine = name.split('\n').map(line => line.trim()).find(Boolean);
  if (firstLine && !/^packet\s+\d+$/i.test(firstLine)) {
    return toTitleCase(firstLine);
  }

  return packet?.number ? `Round ${packet.number}` : 'Round';
}

/**
 * @param {string} setName
 * @param {number} packetNumber
 * @returns {string} the URL of the page that shows the whole round as one document.
 */
function roundPageUrl (setName, packetNumber) {
  return '/db/round?' + new URLSearchParams({ set: setName, round: packetNumber });
}

export { ROUNDS, sanitizeRounds, roundsFilter, packetMatchesRounds, roundOf, roundLabel, roundPageUrl };
