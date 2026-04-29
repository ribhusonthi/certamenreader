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

export {
  escapeHTML,
  removeParentheses,
  titleCase
};
