import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Band, Exercise, LoggedSet, PlannedSet } from '../../types';
import type { SetInput } from '../../db/repo';
import { plannedValue } from '../../lib/format';
import { fmtNum } from '../../generator/progression';

export type Carry = { weight?: number | null; bandId?: string | null; stanceSteps?: number | null };

type Props = {
  index: number;
  ex: Exercise;
  planned?: PlannedSet;
  logged?: LoggedSet;
  carry: Carry;
  bands: Band[];
  onLog: (values: SetInput) => void;
  onUnlog: () => void;
  onDelete?: () => void;
  autoFocusWeight?: boolean;
};

const needsWeight = (ex: Exercise) => ex.weightConvention === 'per-hand' || ex.weightConvention === 'total' || ex.weightConvention === 'assist' || (ex.weightConvention === 'added' && ex.loadType === 'smith');
const hasWeight = (ex: Exercise) => ex.weightConvention !== 'band' && ex.weightConvention !== 'none';

function parseNum(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * One set: weight (or band + stance) and reps (or seconds). Grey placeholders show the plan (reps)
 * and the weight carried from the previous set; typing replaces them. ✓ logs whatever is grey.
 */
export function SetRow({ index, ex, planned, logged, carry, bands, onLog, onUnlog, onDelete, autoFocusWeight }: Props) {
  const timed = ex.metric === 'time';
  const hasLogged = !!logged;
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [bandId, setBandId] = useState<string | null>(null);
  const [stance, setStance] = useState<number | null>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const [nudge, setNudge] = useState('');
  const edited = useRef(false);

  // Logged sets show their values in dark text and stay editable. Reset the inputs only when the stored
  // values change: any write to this session (another set, a sync pull) hands us a fresh object, and
  // resetting on that would wipe what's being typed.
  const lw = logged?.weight;
  const lr = timed ? logged?.seconds : logged?.reps;
  const lb = logged?.bandId;
  const ls = logged?.stanceSteps;
  useEffect(() => {
    if (!hasLogged) return;
    setWeight(lw != null ? fmtNum(lw) : '');
    setReps(String(lr ?? ''));
    setBandId(lb ?? null);
    setStance(ls ?? null);
  }, [hasLogged, lw, lr, lb, ls]);

  useEffect(() => {
    if (autoFocusWeight) weightRef.current?.focus();
  }, [autoFocusWeight]);

  const plannedNum = plannedValue(planned);
  const weightPh = carry.weight != null ? fmtNum(carry.weight) : '';
  const effBand = bandId ?? carry.bandId ?? null;
  const effStance = stance ?? carry.stanceSteps ?? 0;

  const collect = (): SetInput | null => {
    const r = parseNum(reps) ?? plannedNum ?? null;
    if (r == null) return null;
    const out: SetInput = timed ? { seconds: r, reps: null } : { reps: r, seconds: null };
    if (ex.weightConvention === 'band') {
      if (!effBand) {
        setNudge('Pick a band');
        return null;
      }
      out.bandId = effBand;
      out.stanceSteps = effStance;
    } else if (hasWeight(ex)) {
      const w = parseNum(weight) ?? (logged ? null : (carry.weight ?? null));
      if (w == null && needsWeight(ex)) {
        setNudge('Enter a weight');
        weightRef.current?.focus();
        return null;
      }
      out.weight = w;
    }
    setNudge('');
    return out;
  };

  // ✓ on a logged row that was just edited confirms the edit (blur has usually saved it already);
  // only an untouched logged row is un-ticked.
  const tick = () => {
    if (logged) {
      if (edited.current) {
        edited.current = false;
        const v = collect();
        if (v) onLog(v);
        return;
      }
      return onUnlog();
    }
    const v = collect();
    if (v) onLog(v);
  };

  // Enter logs the row, or confirms an edit; it never un-ticks a logged set.
  const onEnter = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!logged || edited.current) tick();
  };

  // Editing a logged set saves on blur.
  const commitEdit = () => {
    if (!logged) return;
    const v = collect();
    if (v) onLog(v);
  };

  return (
    <>
      <tr>
        <td className="set-n">{index + 1}</td>
        {ex.weightConvention === 'band' ? (
          <td>
            <div className="band-chips">
              {bands.map((b) => (
                <button
                  key={b.id}
                  className={`chip ${effBand === b.id ? (bandId || logged ? 'on' : 'ghost') : ''}`}
                  onClick={() => {
                    setBandId(b.id);
                    if (logged) onLog({ ...collectLogged(logged), bandId: b.id });
                  }}
                >
                  {b.name}
                </button>
              ))}
            </div>
            <div className="stepper small" style={{ marginTop: 6 }}>
              <button onClick={() => adjustStance(-1)} aria-label="Closer to the anchor">−</button>
              <span className={stance == null && !logged ? 'faint' : ''}>{effStance} step{effStance === 1 ? '' : 's'}</span>
              <button onClick={() => adjustStance(1)} aria-label="Further from the anchor">+</button>
            </div>
          </td>
        ) : hasWeight(ex) ? (
          <td>
            <input
              ref={weightRef}
              className={`field ${logged ? 'logged' : ''}`}
              inputMode="decimal"
              aria-label={`Set ${index + 1} weight`}
              placeholder={weightPh}
              value={weight}
              onChange={(e) => {
                edited.current = true;
                setWeight(e.target.value);
              }}
              onBlur={commitEdit}
              onKeyDown={onEnter}
            />
          </td>
        ) : (
          <td className="muted small center">bodyweight</td>
        )}
        <td style={{ width: '28%' }}>
          <input
            className={`field ${logged ? 'logged' : ''}`}
            inputMode="numeric"
            aria-label={`Set ${index + 1} ${timed ? 'seconds' : 'reps'}`}
            placeholder={plannedNum != null ? String(plannedNum) : ''}
            value={reps}
            onChange={(e) => {
              edited.current = true;
              setReps(e.target.value);
            }}
            onBlur={commitEdit}
            onKeyDown={onEnter}
          />
        </td>
        <td style={{ width: 60 }}>
          <button className={`check ${logged ? 'on' : ''}`} onClick={tick} aria-label={logged ? `Undo set ${index + 1}` : `Log set ${index + 1}`}>
            ✓
          </button>
        </td>
      </tr>
      {(nudge || (onDelete && !logged)) && (
        <tr>
          <td />
          <td colSpan={3} className="small">
            {nudge && <span style={{ color: 'var(--warn)' }}>{nudge}</span>}
            {onDelete && !logged && (
              <button className="btn ghost small" style={{ float: 'right' }} onClick={onDelete}>Remove set</button>
            )}
          </td>
        </tr>
      )}
    </>
  );

  function adjustStance(d: number) {
    const next = Math.max(0, effStance + d);
    setStance(next);
    if (logged) onLog({ ...collectLogged(logged), stanceSteps: next });
  }
}

function collectLogged(s: LoggedSet): SetInput {
  return { weight: s.weight, reps: s.reps, seconds: s.seconds, bandId: s.bandId, stanceSteps: s.stanceSteps };
}

