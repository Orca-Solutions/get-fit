import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/csv';

describe('csvCell', () => {
  it('opens text a spreadsheet could read as a formula as text', () => {
    for (const s of ['=1+1', '+1+1', '-1+1', '@SUM(1,1)', '\t=1+1', '\r=1+1', ' =1+1', '\u0000=1+1', ' =1+1', '＝1+1', '＋1', '－1', '＠SUM(1)', '-', '=', '\u200b=1', '\u2060=1', '\u200e=1', '\u00ad=1', '\ufeff=1']) {
      expect(csvCell(s).replace(/^"|"$/g, '')).toMatch(/^'/);
    }
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('-5')).toBe("'-5"); // a name, not a number
    expect(csvCell('\t1')).toBe("'\t1");
  });

  it('quotes cells with commas, quotes or line breaks after neutralizing them', () => {
    expect(csvCell('@SUM(1,1)')).toBe(`"'@SUM(1,1)"`);
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('\r=1+1')).toBe(`"'\r=1+1"`);
    expect(csvCell('\n=1+1')).toBe(`"'\n=1+1"`);
    expect(csvCell('Bench, flat')).toBe('"Bench, flat"');
    expect(csvCell('6" box')).toBe('"6"" box"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"');
  });

  it('leaves numbers, ordinary text, Unicode and empty cells alone', () => {
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(95)).toBe('95');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('')).toBe('');
    expect(csvCell('Goblet squat')).toBe('Goblet squat');
    expect(csvCell('Press – 1½ reps 💪')).toBe('Press – 1½ reps 💪');
    expect(csvCell('a=b')).toBe('a=b');
    expect(csvCell('2026-10-19')).toBe('2026-10-19');
    expect(csvCell('2026-10-19T17:00:00.000Z')).toBe('2026-10-19T17:00:00.000Z');
    expect(csvCell(true)).toBe('true');
  });

  it('joins rows into lines', () => {
    expect(toCsv([['a', 'b'], [1, null]])).toBe('a,b\n1,\n');
  });
});
