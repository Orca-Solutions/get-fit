import { useEffect } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { planAfterSync, syncNow } from '@orca-solutions/get-fit-core/client';
import { applyUpdate, useUpdateReady } from './lib/update';
import { useToday } from './lib/hooks';
import Today from './features/today/Today';
import Workout from './features/workout/Workout';
import CalendarView from './features/calendar/Calendar';
import History from './features/history/History';
import MovementHistory from './features/history/MovementHistory';
import Library from './features/library/Library';
import ExerciseDetail from './features/library/ExerciseDetail';
import Settings from './features/settings/Settings';
import PlanPreview from './features/plan/PlanPreview';
import { Icon } from './ui/Icon';

const PLAN_SYNC_WAIT_MS = 4_000;

export default function App() {
  const { pathname } = useLocation();
  const inWorkout = pathname.startsWith('/workout/');
  const today = useToday();
  const updateReady = useUpdateReady();
  // On open, and when the date moves on (an installed app can stay in memory for days): pull what other
  // devices logged, then make sure the current and next block exist (see planAfterSync).
  useEffect(() => {
    planAfterSync(syncNow(), today, PLAN_SYNC_WAIT_MS).catch((err) => console.error('Planning failed', err));
  }, [today]);
  return (
    <>
      <div className={inWorkout ? 'app no-nav' : 'app'}>
        {updateReady && !inWorkout && (
          <div className="update-bar">
            <span>A new version is ready.</span>
            <button className="btn small primary" onClick={applyUpdate}>Update</button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/workout/:plannedId" element={<Workout />} />
          <Route path="/plan/:plannedId" element={<PlanPreview />} />
          <Route path="/calendar" element={<CalendarView />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:exerciseId" element={<MovementHistory />} />
          <Route path="/library" element={<Library />} />
          <Route path="/library/:exerciseId" element={<ExerciseDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Today />} />
        </Routes>
      </div>
      {!inWorkout && (
        <nav className="nav">
          <div className="nav-brand">get-fit</div>
          <NavLink to="/" end><Icon name="today" />Today</NavLink>
          <NavLink to="/calendar"><Icon name="calendar" />Calendar</NavLink>
          <NavLink to="/history"><Icon name="history" />History</NavLink>
          <NavLink to="/library"><Icon name="library" />Library</NavLink>
          <NavLink to="/settings"><Icon name="settings" />Settings</NavLink>
        </nav>
      )}
    </>
  );
}
