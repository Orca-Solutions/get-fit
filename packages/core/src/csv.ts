/**
 * CSV for opening in a spreadsheet. Text that a spreadsheet could read as a formula (it starts with
 * = + - @, a tab or a carriage return, the full-width forms of those signs, or any of them after leading
 * spaces or control characters) gets a leading apostrophe, so it opens as text: a band named "=1+1" shows
 * as '=1+1 rather than 2. Numbers are never changed, negatives included, and ordinary text, Unicode and
 * empty cells pass through. Cells holding a comma, quote or line break are quoted, with quotes doubled.
 * The apostrophe stays in the file, so text read back from the CSV keeps it.
 */
const FORMULA = /^[\s\p{Cc}]*[=+\-@＝＋－＠]|^[\t\r]/u;

export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return '';
  const s = typeof v === 'string' && FORMULA.test(v) ? `'${v}` : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text, one line per row, ending in a newline. */
export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
