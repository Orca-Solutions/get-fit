import { Link } from 'react-router-dom';
import type { Band, Exercise, Profile } from '../../types';
import { bestSet, describeLoad, type SessionSummary } from '../../generator/progression';
import { formatMonthDay } from '../../lib/dates';

export function setText(ex: Exercise, s: { weight?: number | null; reps?: number | null; seconds?: number | null; bandId?: string | null; stanceSteps?: number | null }, bands: Band[]): string {
  const bandName = (id: string) => bands.find((b) => b.id === id)?.name ?? 'band';
  const amount = s.seconds != null ? `${s.seconds}s` : `${s.reps ?? '?'}`;
  if (ex.weightConvention === 'none') return amount;
  if (ex.weightConvention === 'band') return `${describeLoad(ex, s, bandName)} × ${amount}`;
  if (s.weight == null) return amount;
  const w = ex.weightConvention === 'assist' ? `−${s.weight}` : ex.weightConvention === 'added' && ex.loadType !== 'smith' ? `+${s.weight}` : `${s.weight}`;
  return `${w}×${amount}`;
}

/** Last few sessions of this movement, best set, and an e1RM sparkline. */
export function HistoryPanel({ ex, history, profile, limit = 3 }: { ex: Exercise; history: SessionSummary[]; profile: Profile; limit?: number }) {
  if (!history.length) {
    return (
      <div className="card small muted">
        No history yet. Today's sets become the baseline.
      </div>
    );
  }
  const best = bestSet(ex, history, profile);
  const series = history.map((h) => h.bestE1rm).filter((v): v is number => v != null).reverse();
  return (
    <div className="card">
      <div className="row small muted" style={{ marginBottom: 4 }}>
        <span className="grow">History</span>
        <Link to={`/history/${ex.id}`}>See all ›</Link>
      </div>
      {history.slice(0, limit).map((h) => (
        <div className="history-line" key={h.sessionId}>
          <span className="d">{formatMonthDay(h.date)}</span>
          <span className="grow">{h.sets.map((s) => setText(ex, s, profile.bands)).join(', ')}</span>
        </div>
      ))}
      {best && (
        <div className="row small" style={{ marginTop: 6 }}>
          <span className="muted">Best: {setText(ex, best.set, profile.bands)}</span>
          <span className="grow" />
          {series.length >= 2 && <Sparkline values={series} />}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 120, height = 32 }: { values: number[]; width?: number; height?: number }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 2 - ((v - min) / span) * (height - 4)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="Estimated 1-rep max trend">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
