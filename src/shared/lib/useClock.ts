import { useEffect, useState } from 'react';

const STARTED_AT = Date.now();

export function useClock(intervalMs = 60_000): number {
  const [clock, setClock] = useState(STARTED_AT);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return clock;
}
