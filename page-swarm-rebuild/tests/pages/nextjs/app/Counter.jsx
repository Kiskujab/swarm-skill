'use client';
import { useState } from 'react';

// Hydration probe: the button only counts after React has hydrated the page.
export default function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" className="counter" data-testid="counter" onClick={() => setN((v) => v + 1)}>
      Clicked {n} times
    </button>
  );
}
