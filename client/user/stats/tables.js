// Sortable stats tables. Clicking a column heading (or pressing Enter or Space
// on it) sorts the table body by that column; doing it again reverses the
// order. Headings opt in with data-sort="text" or data-sort="number".
//
// The headings used to call a global sortTable() from onclick attributes, but
// this file loads as a module, so the function was never global and clicking
// a heading did nothing.

function cellValue (row, column, numeric) {
  const text = row.cells[column]?.textContent.trim() ?? '';
  if (!numeric) return text.toLowerCase();
  const number = parseFloat(text);
  return Number.isNaN(number) ? null : number;
}

// Text sorts A to Z first; numbers sort largest first, the more useful order
// for stats. Cells with no number go last.
function compare (a, b, numeric) {
  if (!numeric) return a.localeCompare(b);
  if (a === null || b === null) return (a === null) - (b === null);
  return b - a;
}

function sortTable (heading) {
  const body = heading.closest('table')?.tBodies[0];
  if (!body) return;

  const column = heading.cellIndex;
  const numeric = heading.dataset.sort === 'number';
  const rows = [...body.rows].map(row => ({ row, value: cellValue(row, column, numeric) }));
  const sorted = [...rows].sort((x, y) => compare(x.value, y.value, numeric));

  // Already in that order: reverse it.
  const reversed = sorted.every((entry, i) => entry === rows[i]);
  if (reversed) sorted.reverse();
  body.append(...sorted.map(entry => entry.row));

  for (const cell of heading.parentElement.cells) cell.removeAttribute('aria-sort');
  const firstOrder = numeric ? 'descending' : 'ascending';
  const otherOrder = numeric ? 'ascending' : 'descending';
  heading.setAttribute('aria-sort', reversed ? otherOrder : firstOrder);
}

const sortableHeading = target => target.closest?.('thead th[data-sort]');

document.addEventListener('click', event => {
  const heading = sortableHeading(event.target);
  if (heading) sortTable(heading);
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const heading = sortableHeading(event.target);
  if (!heading) return;
  event.preventDefault();
  sortTable(heading);
});
