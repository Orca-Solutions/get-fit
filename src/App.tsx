import { useEffect } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ensurePlan } from './db/repo';
import { syncNow } from './lib/sync';
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

export default function App() {
  const { pathname } = useLocation();
  const inWorkout = pathname.startsWith('/workout/');
  const today = useToday();
  // An installed app can stay in memory for days: roll into the next block when the date moves on,
  // after pulling what other devices logged.
  useEffect(() => {
    syncNow()
      .then(() => ensurePlan(today))
      .catch(() => {});
  }, [today]);
  return (
    <>
      <div className={inWorkout ? 'app no-nav' : 'app'}>
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
