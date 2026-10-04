"use client";
import { useEffect, useState } from "react";
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
export function DiceFace({ value = 5 }: { value?: number }) {
  return (
    <span className="dice-face" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i
          key={i}
          className={PIPS[value]?.includes(i) ? "pip visible" : "pip"}
        />
      ))}
    </span>
  );
}
export default function Dice({
  value,
  canRoll,
  onRoll,
  rolling,
}: {
  value: number | null;
  canRoll: boolean;
  onRoll: () => void;
  rolling: boolean;
}) {
  const [face, setFace] = useState(1);
  useEffect(() => {
    if (
      !rolling ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = setInterval(
      () => setFace((current) => (current % 6) + 1),
      75,
    );
    return () => clearInterval(timer);
  }, [rolling]);
  return (
    <button
      onClick={onRoll}
      disabled={!canRoll || rolling}
      className={`dice-button ${rolling ? "rolling" : ""}`}
      aria-busy={rolling}
      aria-label={
        rolling
          ? "Rolling dice"
          : value
            ? `Roll dice. Last roll: ${value}`
            : "Roll dice"
      }
    >
      <DiceFace value={rolling ? face : (value ?? 5)} />
      <span className="sr-only" role="status">
        {rolling ? "Rolling…" : value ? `Rolled ${value}` : "Ready to roll"}
      </span>
    </button>
  );
}
