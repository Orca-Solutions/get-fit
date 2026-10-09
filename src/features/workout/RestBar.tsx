import { formatRest, progress, restTimer, secondsLeft, STEP_SEC, useNow, useRestTimer } from '../../lib/restTimer';

/** A slim countdown above the workout's Prev / Next buttons. Calm by design: no pop-ups, no alarms. */
export function RestBar() {
  const rest = useRestTimer();
  const now = useNow(!!rest);
  if (!rest) return null;
  const left = secondsLeft(rest, now);
  const over = left <= 0;
  return (
    <div className={`rest-bar ${over ? 'over' : ''}`} role="timer" aria-live="off">
      <div className="rest-fill" style={{ transform: `scaleX(${progress(rest, now)})` }} />
      <span className="rest-time">
        {over ? (
          <>Rest's up{left < 0 && <span className="muted"> · {formatRest(left)} ago</span>}</>
        ) : (
          <>Rest <b>{formatRest(left)}</b></>
        )}
      </span>
      {!over && (
        <>
          <button className="chip" onClick={() => restTimer.adjust(-STEP_SEC)} aria-label="30 seconds less">−30</button>
          <button className="chip" onClick={() => restTimer.adjust(STEP_SEC)} aria-label="30 seconds more">+30</button>
        </>
      )}
      <button className="chip" onClick={() => restTimer.stop()}>{over ? 'Hide' : 'Skip'}</button>
    </div>
  );
}
