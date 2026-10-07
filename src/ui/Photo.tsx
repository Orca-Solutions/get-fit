import { useEffect, useState } from 'react';
import type { Exercise } from '../types';

/** Start/end photos shown as a looping flip, like a two-frame demo. */
export function Photo({ ex, size = 84, onClick }: { ex: Exercise; size?: number; onClick?: () => void }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (ex.images.length < 2) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % ex.images.length), 900);
    return () => clearInterval(t);
  }, [ex.images.length]);
  if (!ex.images.length) return null;
  return <img className="photo" style={{ width: size, height: size }} src={`/${ex.images[frame]}`} alt={`${ex.name} demo`} onClick={onClick} />;
}
