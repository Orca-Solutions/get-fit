/**
 * CSV for opening in a spreadsheet. Text that a spreadsheet could read as a formula gets a leading
 * apostrophe, so it opens as text: a band named "=1+1" shows as '=1+1 rather than 2. That's text starting
 * with = + - @ or their full-width forms, also after leading spaces, control characters or invisible
 * format characters (a zero-width space, say), and text starting with a tab or carriage return. Numbers
 * are never changed, negatives included, and ordinary text, Unicode and empty cells pass through. Cells
 * holding a comma, quote or line break are quoted, with quotes doubled. The apostrophe stays in the file,
 * so text read back from the CSV keeps it.
 */
const FORMULA = /^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]|^[\t\r]/u;

export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return '';
  const s = typeof v === 'string' && FORMULA.test(v) ? `'${v}` : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text, one line per row, ending in a newline. */
export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
