import { formatRest, progress, restTimer, secondsLeft, STEP_SEC, useNow, useRestTimer } from '../../lib/restTimer';

/**
 * Rest between sets, in the thumb zone above Prev / Next (a small label, a large count, a
 * thin bar, ±30 s, tap to dismiss). Calm by design: no pop-ups, no alarms.
 */
export function RestBar() {
  const rest = useRestTimer();
  const now = useNow(!!rest);
  if (!rest) return null;
  const left = secondsLeft(rest, now);
  const over = left <= 0;
  return (
    <div className={`rest-bar ${over ? 'over' : ''}`} role="timer" aria-live="off">
      <button className="rest-main" onClick={() => restTimer.stop()} aria-label="Dismiss rest timer">
        <span className="rest-label">{over ? (left < 0 ? `Rest's up · ${formatRest(left)} ago` : "Rest's up") : 'Rest'}</span>
        <span className="rest-time">{formatRest(Math.max(0, left))}</span>
        <span className="rest-track"><span className="rest-fill" style={{ transform: `scaleX(${progress(rest, now)})` }} /></span>
      </button>
      {!over && (
        <>
          <button className="btn rest-step" onClick={() => restTimer.adjust(-STEP_SEC)} aria-label="30 seconds less">−30</button>
          <button className="btn rest-step" onClick={() => restTimer.adjust(STEP_SEC)} aria-label="30 seconds more">+30</button>
        </>
      )}
    </div>
  );
}
