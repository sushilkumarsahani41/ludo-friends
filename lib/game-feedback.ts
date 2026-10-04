import { FINISHED, type LudoGameState } from "./ludo-engine";
import type { GameSound } from "./game-audio";

export const DICE_ROLL_MS = 680;
export const AUTO_MOVE_PAUSE_MS = 280;
export function isNewRoll(
  previous: LudoGameState | null,
  next: LudoGameState,
): boolean {
  return (
    !!previous &&
    previous.roomId === next.roomId &&
    !!next.lastRoll &&
    next.lastRoll.id === (previous.lastRoll?.id ?? 0) + 1
  );
}
export function moveSound(
  previous: LudoGameState | null,
  next: LudoGameState,
): GameSound | null {
  if (
    !previous ||
    previous.roomId !== next.roomId ||
    previous.players.length !== next.players.length
  )
    return null;
  if (previous.stage !== "game-over" && next.stage === "game-over")
    return "win";
  let captured = false,
    home = false;
  next.players.forEach((player, pi) =>
    player.tokens.forEach((step, ti) => {
      const old = previous.players[pi].tokens[ti];
      if (old >= 0 && step === -1) captured = true;
      if (old !== FINISHED && step === FINISHED) home = true;
    }),
  );
  return captured ? "capture" : home ? "home" : null;
}
