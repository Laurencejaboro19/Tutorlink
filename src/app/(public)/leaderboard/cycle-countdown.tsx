"use client";

import { useEffect, useState } from "react";
import { countdownLabel } from "./countdown";

/** Live countdown to the cycle end; renders the server-computed label first so it is never blank. */
export function CycleCountdown({ endsAt, initialLabel }: { endsAt: string; initialLabel: string }) {
  const [text, setText] = useState(initialLabel);
  useEffect(() => {
    const end = new Date(endsAt).getTime();
    const tick = () => setText(countdownLabel(end - Date.now()));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [endsAt]);
  return (
    <span role="timer" aria-live="off">
      {text}
    </span>
  );
}
