/**
 * Authoritative Ludo rules engine — pure, deterministic, shared by
 * client (preview) and server (source of truth).
 *
 * Token model: steps = -1 (yard) | 0..56 (on board) | 57 (finished)
 *  - steps 0..50  -> main 52-cell track, absolute = (startOffset + steps) % 52
 *  - steps 51..56 -> private home-stretch (uncapturable)
 *  - steps 57      -> finished (home triangle)
 */

export type LudoColor = "red" | "green" | "yellow" | "blue";

export const COLORS: LudoColor[] = ["red", "green", "yellow", "blue"];

/** Two-player games use diagonally opposite yards. */
export function oppositeColor(color: LudoColor): LudoColor {
  return COLORS[(COLORS.indexOf(color) + 2) % 4];
}

export function colorsForPlayers(
  count: number,
  first: LudoColor = "red",
): LudoColor[] {
  return count === 2
    ? [first, oppositeColor(first)]
    : [first, ...COLORS.filter((color) => color !== first)].slice(0, count);
}

export const START_OFFSET: Record<LudoColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

export const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export const YARD = -1;
export const FINISHED = 57;
export const LAST_TRACK_STEP = 50;
export const MAX_PLAYERS = 4;

export interface LudoPlayerState {
  color: LudoColor;
  name: string;
  tokens: number[]; // length 4, values -1..57
  finished: boolean;
  consecutiveSixes: number;
}

export interface LudoGameState {
  roomId: string;
  players: LudoPlayerState[];
  turnIdx: number;
  dice: number | null;
  stage: "await-roll" | "await-move" | "game-over";
  lastRoll?: {
    id: number;
    value: number;
    player: LudoColor;
    forfeited?: boolean;
  };
  winner?: LudoColor;
  rank: LudoColor[];
}

export interface MoveResult {
  state: LudoGameState;
  captured: { color: LudoColor; tokenIdx: number }[];
  extraTurn: boolean;
  forfeited?: boolean;
}

export function createGame(
  roomId: string,
  roster: { color: LudoColor; name: string }[],
): LudoGameState {
  if (roster.length < 2 || roster.length > 4)
    throw new Error("Need 2-4 players");
  const colors = roster.map((r) => r.color);
  if (new Set(colors).size !== colors.length)
    throw new Error("Duplicate colors");
  return {
    roomId,
    players: roster.map((r) => ({
      color: r.color,
      name: r.name,
      tokens: [YARD, YARD, YARD, YARD],
      finished: false,
      consecutiveSixes: 0,
    })),
    turnIdx: 0,
    dice: null,
    stage: "await-roll",
    rank: [],
  };
}

export function absoluteCell(color: LudoColor, steps: number): number | null {
  if (steps < 0 || steps > LAST_TRACK_STEP) return null; // yard / stretch / finished
  return (START_OFFSET[color] + steps) % 52;
}

export function isSafeAbsolute(abs: number): boolean {
  return SAFE_CELLS.has(abs);
}

/** All occupants of an absolute track cell: [{playerIdx, tokenIdx}] */
function occupantsAt(
  state: LudoGameState,
  abs: number,
): { playerIdx: number; tokenIdx: number }[] {
  const out: { playerIdx: number; tokenIdx: number }[] = [];
  state.players.forEach((p, pi) => {
    p.tokens.forEach((s, ti) => {
      if (s >= 0 && s <= LAST_TRACK_STEP && absoluteCell(p.color, s) === abs) {
        out.push({ playerIdx: pi, tokenIdx: ti });
      }
    });
  });
  return out;
}

/**
 * Can token `tokenIdx` of current player legally move with `dice`?
 * Enforces: need 6 from yard, exact finish, no-pass on 2+ blockade of another color.
 */
export function canMoveToken(
  state: LudoGameState,
  playerIdx: number,
  tokenIdx: number,
  dice: number,
): boolean {
  const p = state.players[playerIdx];
  if (!p || state.stage !== "await-move") return false;
  const steps = p.tokens[tokenIdx];
  if (steps === FINISHED) return false;
  if (steps === YARD) return dice === 6;

  const dest = steps + dice;
  if (dest > FINISHED) return false;

  // Blockade rule: destination occupied by 2+ tokens of a *different* single color on unsafe cell
  if (dest <= LAST_TRACK_STEP) {
    const abs = absoluteCell(p.color, dest)!;
    if (!isSafeAbsolute(abs)) {
      const occ = occupantsAt(state, abs).filter(
        (o) => o.playerIdx !== playerIdx,
      );
      const byColor = new Map<number, number>();
      for (const o of occ)
        byColor.set(o.playerIdx, (byColor.get(o.playerIdx) ?? 0) + 1);
      for (const n of byColor.values()) if (n >= 2) return false;
    }
  }
  return true;
}

export function getLegalMoves(
  state: LudoGameState,
  playerIdx: number,
  dice: number,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++)
    if (canMoveToken(state, playerIdx, i, dice)) out.push(i);
  return out;
}

/** Automatically move only when there is exactly one legal token, never choose for a player. */
export function getOnlyLegalMove(state: LudoGameState): number | null {
  if (state.stage !== "await-move" || state.dice == null) return null;
  const moves = getLegalMoves(state, state.turnIdx, state.dice);
  return moves.length === 1 ? moves[0] : null;
}

function clone(state: LudoGameState): LudoGameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, tokens: [...p.tokens] })),
    rank: [...state.rank],
  };
}

function advanceTurn(s: LudoGameState): void {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (s.turnIdx + i) % n;
    if (!s.players[idx].finished) {
      s.turnIdx = idx;
      break;
    }
  }
  s.dice = null;
  s.stage = "await-roll";
}

/**
 * Apply a validated move. Caller must have rolled dice and checked turn/stage.
 * Handles capture, extra turn (6/capture/finish-token), 3-six forfeit upstream,
 * win detection, and turn advancement.
 */
export function applyMove(
  prev: LudoGameState,
  playerIdx: number,
  tokenIdx: number,
  dice: number,
): MoveResult {
  if (prev.stage !== "await-move") throw new Error("Not in move stage");
  if (prev.turnIdx !== playerIdx) throw new Error("Not your turn");
  if (!canMoveToken(prev, playerIdx, tokenIdx, dice))
    throw new Error("Illegal move");

  const s = clone(prev);
  const me = s.players[playerIdx];
  const from = me.tokens[tokenIdx];
  const dest = from === YARD ? 0 : from + dice;
  if (dest > FINISHED) throw new Error("Need exact roll to finish");

  const captured: { color: LudoColor; tokenIdx: number }[] = [];
  let finishedToken = false;

  if (dest === FINISHED) {
    finishedToken = true;
  } else if (dest <= LAST_TRACK_STEP) {
    const abs = absoluteCell(me.color, dest)!;
    if (!isSafeAbsolute(abs)) {
      const victims = occupantsAt(s, abs).filter(
        (o) => o.playerIdx !== playerIdx,
      );
      // Capture only if no 2+ blockade (already enforced) — capture singletons
      // If victims are mixed colors, all singletons are captured (standard rule variant).
      const byColor = new Map<number, number>();
      for (const v of victims)
        byColor.set(v.playerIdx, (byColor.get(v.playerIdx) ?? 0) + 1);
      const blocked = [...byColor.values()].some((n) => n >= 2);
      if (!blocked) {
        for (const v of victims) {
          s.players[v.playerIdx].tokens[v.tokenIdx] = YARD;
          captured.push({
            color: s.players[v.playerIdx].color,
            tokenIdx: v.tokenIdx,
          });
        }
      }
    }
  }

  me.tokens[tokenIdx] = dest;

  // Win check: all 4 finished
  if (me.tokens.every((t) => t === FINISHED)) {
    me.finished = true;
    s.rank.push(me.color);
    if (
      s.rank.length >= s.players.length - 1 ||
      s.rank.length === s.players.length
    ) {
      s.stage = "game-over";
      s.winner = s.rank[0];
      s.dice = dice;
      return { state: s, captured, extraTurn: false };
    }
    // Winner stops playing; pass turn
    me.consecutiveSixes = 0;
    advanceTurn(s);
    return { state: s, captured, extraTurn: false };
  }

  const rolledSix = dice === 6;
  const extraTurn = rolledSix || captured.length > 0 || finishedToken;
  if (extraTurn) {
    s.dice = null;
    s.stage = "await-roll";
    // turnIdx unchanged
  } else {
    me.consecutiveSixes = 0;
    advanceTurn(s);
  }
  return { state: s, captured, extraTurn };
}

/** Set dice after a roll; handles 3-six forfeit. Returns updated state + forfeited flag. */
export function applyRoll(
  prev: LudoGameState,
  playerIdx: number,
  dice: number,
): { state: LudoGameState; forfeited: boolean } {
  if (prev.stage !== "await-roll") throw new Error("Not in roll stage");
  if (prev.turnIdx !== playerIdx) throw new Error("Not your turn");
  if (dice < 1 || dice > 6) throw new Error("Bad dice");

  const s = clone(prev);
  const me = s.players[playerIdx];
  s.lastRoll = {
    id: (prev.lastRoll?.id ?? 0) + 1,
    value: dice,
    player: me.color,
  };

  if (dice === 6) {
    me.consecutiveSixes += 1;
    if (me.consecutiveSixes >= 3) {
      s.lastRoll.forfeited = true;
      me.consecutiveSixes = 0;
      advanceTurn(s); // forfeit, no move
      return { state: s, forfeited: true };
    }
  } else {
    me.consecutiveSixes = 0;
  }

  s.dice = dice;
  s.stage = "await-move";

  // No legal moves -> auto pass (server will advance)
  if (getLegalMoves(s, playerIdx, dice).length === 0) {
    if (dice === 6) {
      // rolled six but stuck in yard-blocked edge: keep turn, await next roll? Standard: pass turn.
      // Keep simple: stay on same player for re-roll only if six AND at least... no — pass to avoid lock.
    }
    advanceTurn(s);
    return { state: s, forfeited: false };
  }
  return { state: s, forfeited: false };
}

/** Secure server-side dice. */
export function secureDice(): number {
  // crypto.randomInt is uniform 1..6 inclusive-exclusive(max)
  // Avoid importing node:crypto at module top so client bundle stays clean.
  const c: Crypto = globalThis.crypto as Crypto;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return (buf[0] % 6) + 1;
  }
  return Math.floor(Math.random() * 6) + 1;
}

export function makeRoomCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  const c = globalThis.crypto as Crypto | undefined;
  for (let i = 0; i < 6; i++) {
    const r = c?.getRandomValues
      ? (() => {
          const b = new Uint32Array(1);
          c.getRandomValues(b);
          return b[0] % alphabet.length;
        })()
      : Math.floor(Math.random() * alphabet.length);
    code += alphabet[r];
  }
  return code;
}
