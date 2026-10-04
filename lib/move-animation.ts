import type { LudoGameState } from "./ludo-engine";

export const TOKEN_STEP_MS = 180;
export const CAPTURE_RETURN_MS = 560;
export interface MoveFrame {
  game: LudoGameState;
  movingToken: string | null;
  returningTokens?: string[];
  durationMs?: number;
}

/** Intermediate visual states only; the authoritative result is never mutated. */
export function moveFrames(
  previous: LudoGameState | null,
  next: LudoGameState,
): MoveFrame[] {
  const final = { game: next, movingToken: null };
  if (
    !previous ||
    previous.roomId !== next.roomId ||
    previous.players.length !== next.players.length
  )
    return [final];
  const forward: { player: number; token: number; from: number; to: number }[] =
    [];
  next.players.forEach((player, pi) => {
    if (previous.players[pi].color !== player.color) return;
    player.tokens.forEach((to, ti) => {
      const from = previous.players[pi].tokens[ti];
      if (to > from) forward.push({ player: pi, token: ti, from, to });
    });
  });
  // Initial loads/reconnections may skip many moves: show the current board directly.
  if (forward.length !== 1) return [final];
  const { player, token, from, to } = forward[0];
  if (to - from > 6 || (from === -1 && to !== 0)) return [final];
  const frames: MoveFrame[] = [];
  for (let step = from + 1; step <= to; step++) {
    frames.push({
      game: {
        ...previous,
        players: previous.players.map((p, pi) =>
          pi === player
            ? {
                ...p,
                tokens: p.tokens.map((value, ti) =>
                  ti === token ? step : value,
                ),
              }
            : p,
        ),
      },
      movingToken: `${next.players[player].color}-${token}`,
    });
  }
  // After landing, hold the turn while each captured goti slides to its yard.
  const returningTokens = next.players.flatMap((p, pi) =>
    p.tokens.flatMap((step, ti) =>
      step === -1 && previous.players[pi].tokens[ti] >= 0
        ? [`${p.color}-${ti}`]
        : [],
    ),
  );
  if (returningTokens.length) {
    frames.push({
      game: { ...frames[frames.length - 1].game, players: next.players },
      movingToken: null,
      returningTokens,
      durationMs: CAPTURE_RETURN_MS,
    });
  }
  return [...frames, final];
}
