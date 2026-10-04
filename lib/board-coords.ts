import type { LudoColor } from "./ludo-engine";
import { START_OFFSET, SAFE_CELLS } from "./ludo-engine";

/** (row, col) on 15x15 grid, track index 0..51 starting at red start. */
export const TRACK_COORDS: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];

export const HOME_STRETCH: Record<LudoColor, [number, number][]> = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};

export const YARD_SPOTS: Record<LudoColor, [number, number][]> = {
  red: [[2, 2], [2, 3], [3, 2], [3, 3]],
  green: [[2, 11], [2, 12], [3, 11], [3, 12]],
  yellow: [[11, 11], [11, 12], [12, 11], [12, 12]],
  blue: [[11, 2], [11, 3], [12, 2], [12, 3]],
};

export const FINISH_SPOTS: [number, number][] = [[7, 6], [6, 7], [7, 8], [8, 7]];

/** Grid cell -> token steps position for a color. */
export function cellForToken(color: LudoColor, steps: number): [number, number] | null {
  if (steps === -1) return null; // caller uses YARD_SPOTS[tokenIdx]
  if (steps >= 0 && steps <= 50) {
    const abs = (START_OFFSET[color] + steps) % 52;
    return TRACK_COORDS[abs];
  }
  if (steps >= 51 && steps <= 55) return HOME_STRETCH[color][steps - 51];
  if (steps === 56) return [7, 7]; // entered center, one before finish visual
  return [7, 7]; // 57 finished -> center cluster
}

export function isSafeTrackIndex(abs: number): boolean {
  return SAFE_CELLS.has(abs);
}
