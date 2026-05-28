function escapeHTML (unsafe) {
  return unsafe?.replaceAll('&', '&amp;')?.replaceAll('<', '&lt;')?.replaceAll('>', '&gt;')?.replaceAll('"', '&quot;')?.replaceAll('\'', '&#039;');
}

function removeParentheses (string) {
  const original = String(string ?? '').replace(/\s+/g, ' ').trim();
  const cleaned = original.replace(/\[.*/, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || original;
}

function titleCase (name) {
  return name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Render a Certamen answerline so the reveal is readable instead of a wall of
// braces and slashes. The raw form
//   Patriam {(Prō)Tegere / Dēfendere / Cūstōdīre / Tuērī / Servāre} Melius (Est) {Quam (Ex)Fugere // (Ex)Fugiendō} [Accept Equivalents]
// becomes
//   Patriam <em>(prō)tegere / dēfendere / cūstōdīre / tuērī / servāre</em>
//   Melius <small>(est)</small> <em>quam (ex)fugere / (ex)fugiendō</em>
//   <small>[Accept Equivalents]</small>
// directives are pulled into a muted suffix, brace alternatives are
// italicized, and optional parens are kept but muted.
function formatAnswerline (answerline) {
  if (answerline == null) return '';
  let s = String(answerline);

  const directives = [];
  s = s.replace(/\[([^\]]+)\]/g, (_, d) => {
    directives.push(d.trim());
    return '';
  });

  s = s.replace(/\{([^{}]+)\}/g, (_, inner) => {
    const alts = inner.split(/\/+/).map(x => x.trim()).filter(Boolean);
    return `<em>${alts.join(' / ')}</em>`;
  });

  s = s.replace(/\(([^)]+)\)/g, (_, content) =>
    `<small class="text-muted">(${content.trim()})</small>`);

  s = s.replace(/\s+/g, ' ').trim();

  if (directives.length > 0) {
    s += ` <small class="text-muted">[${directives.join('; ')}]</small>`;
  }

  return s;
}

export {
  escapeHTML,
  formatAnswerline,
  removeParentheses,
  titleCase
};
