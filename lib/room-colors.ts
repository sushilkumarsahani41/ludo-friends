import { COLORS, oppositeColor, type LudoColor } from "./ludo-engine";

/** Shared by the UI and server so taken colors and opposite seats agree. */
export function availableColors(
  size: number,
  players: { color: LudoColor }[],
  playerIdx?: number,
): LudoColor[] {
  const others = players.filter((_, index) => index !== playerIdx);
  return COLORS.filter(
    (color) =>
      !others.some((p) => p.color === color) &&
      (size !== 2 ||
        others.length === 0 ||
        color === oppositeColor(others[0].color)),
  );
}
