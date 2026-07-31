// Set names follow the convention "<Tournament> <Difficulty> <Year>", e.g.
// "Harvard Advanced 2015". The home page groups sets into tournament series
// and links to /db?series=<name>; the database page expands that back into the
// individual set names. Both sides have to agree on the parse, so it lives
// here rather than being duplicated.

const DIFF_LABEL = { 1: 'Novice', 5: 'Intermediate', 10: 'Advanced' };

function parseTournament (setName) {
  const parts = String(setName).trim().split(/\s+/);
  if (parts.length < 3) return setName;
  return parts.slice(0, -2).join(' ');
}

function parseYear (setName) {
  const parts = String(setName).trim().split(/\s+/);
  const y = parseInt(parts[parts.length - 1], 10);
  return Number.isFinite(y) ? y : null;
}

function parseDifficultyValue (setName) {
  const parts = String(setName).trim().split(/\s+/);
  if (parts.length < 2) return null;
  const d = parts[parts.length - 2].toLowerCase();
  if (d === 'novice') return 1;
  if (d === 'intermediate') return 5;
  if (d === 'advanced' || d === 'elite') return 10;
  return null;
}

/** Every set name belonging to a tournament series. */
function setsInSeries (setList, series) {
  return (setList || []).filter(name => parseTournament(name) === series);
}

export { DIFF_LABEL, parseTournament, parseYear, parseDifficultyValue, setsInSeries };
