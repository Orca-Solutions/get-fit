// Prints a generated block as Markdown: `npm run sample -- [startMonday] [blocks]`.
import catalog from '../src/data/exercises.json' with { type: 'json' };
import { generateBlock } from '../src/generator/generateBlock';
import { defaultProfile } from '../src/lib/defaultProfile';
import { prescription } from '../src/lib/format';
import { formatShort } from '../src/lib/dates';
import type { Block, Exercise } from '../src/types';

const exercises = catalog as unknown as Exercise[];
const byId = new Map(exercises.map((e) => [e.id, e]));
const start = process.argv[2] ?? '2026-10-12';
const blocks = Number(process.argv[3] ?? 1);

let prev: Block | undefined;
for (let b = 0; b < blocks; b++) {
  const startDate = prev ? addWeeks(prev.startDate, 4) : start;
  const { block, workouts, coverage } = generateBlock({ profile: defaultProfile('2026-10-07T00:00:00Z'), exercises, startDate, previousBlock: prev, now: '2026-10-07T00:00:00Z' });
  console.log(`# Block ${block.index} (starts ${formatShort(block.startDate)})\n\n${block.rationale}\n`);
  for (const w of workouts) {
    const sets = w.exercises.reduce((k, e) => k + e.sets.length, 0);
    console.log(`## ${formatShort(w.date)} · ${w.focus} (${w.exercises.length} movements, ${sets} sets, RIR ${w.exercises[0].sets[0].rir})\n\n_${w.rationale}_\n`);
    for (const pe of w.exercises) {
      const ex = byId.get(pe.exerciseId)!;
      const tag = pe.supersetGroup ? pe.supersetGroup : pe.role;
      console.log(`- ${tag} · ${ex.name}: ${prescription(pe, ex)}${pe.note && !pe.note.startsWith('First time') ? ` (${pe.note.replace(/ ?First time:.*$/, '')})` : ''}`);
    }
    console.log('');
  }
  console.log('### Weekly sets per muscle (direct 1, indirect 0.5)\n');
  console.log('| Muscle | Wk 1 | Wk 2 | Wk 3 | Avg |\n|---|---|---|---|---|');
  for (const g of Object.keys(coverage.average) as (keyof typeof coverage.average)[]) {
    console.log(`| ${g} | ${coverage.weeks.map((w) => w[g]).join(' | ')} | ${coverage.average[g]} |`);
  }
  if (coverage.warnings.length) console.log(`\nWarnings:\n${coverage.warnings.map((w) => `- ${w}`).join('\n')}`);
  console.log('');
  prev = block;
}

function addWeeks(d: string, w: number) {
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + w * 7);
  return x.toISOString().slice(0, 10);
}
