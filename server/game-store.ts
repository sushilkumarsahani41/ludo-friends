import {
  applyRoll,
  applyMove,
  getLegalMoves,
  getOnlyLegalMove,
  type MoveResult,
  secureDice,
  type LudoGameState,
  type LudoColor,
} from "../lib/ludo-engine";

import { availableColors } from "../lib/room-colors";
import { AUTO_MOVE_PAUSE_MS, DICE_ROLL_MS } from "../lib/game-feedback";

export interface Room {
  game: LudoGameState;
  started: boolean;
  socketToPlayer: Map<string, number>;
  playerIdToIdx: Map<string, number>;
  timer?: NodeJS.Timeout;
  autoMoveTimer?: NodeJS.Timeout;
  turnDeadline: number;
  size: number;
  lastAction: Map<string, number>;
}

export const rooms = new Map<string, Room>();
export const TURN_MS = 30_000;

export function getOrCreateRoom(roomId: string, size = 4): Room {
  let r = rooms.get(roomId);
  if (!r) {
    const game: LudoGameState = {
      roomId,
      players: [],
      turnIdx: 0,
      dice: null,
      stage: "await-roll",
      rank: [],
    };
    r = {
      game,
      started: false,
      socketToPlayer: new Map(),
      playerIdToIdx: new Map(),
      turnDeadline: 0,
      size,
      lastAction: new Map(),
    };
    rooms.set(roomId, r);
  }
  return r;
}

export function addPlayer(
  room: Room,
  name: string,
  playerId: string,
  preferredColor?: LudoColor,
): number {
  const existing = room.playerIdToIdx.get(playerId);
  if (existing !== undefined) return existing;
  if (room.game.players.length >= room.size) throw new Error("ROOM_FULL");
  const available = availableColors(room.size, room.game.players);
  const color = preferredColor ?? available[0];
  if (!available.includes(color))
    throw new Error(
      "That color is unavailable. Choose another available color.",
    );
  room.game.players.push({
    color,
    name,
    tokens: [-1, -1, -1, -1],
    finished: false,
    consecutiveSixes: 0,
  });
  const idx = room.game.players.length - 1;
  room.playerIdToIdx.set(playerId, idx);
  return idx;
}

export function selectPlayerColor(
  room: Room,
  socketId: string,
  color: LudoColor,
): void {
  const index = room.socketToPlayer.get(socketId);
  if (index === undefined)
    throw new Error("Join the room before choosing a color.");
  if (room.started) throw new Error("Colors are locked once the game starts.");
  if (!availableColors(room.size, room.game.players, index).includes(color)) {
    throw new Error(
      "That color is unavailable. Choose another available color.",
    );
  }
  room.game = {
    ...room.game,
    players: room.game.players.map((p, i) =>
      i === index ? { ...p, color } : p,
    ),
  };
}

/** Host is the first player; reconnecting preserves this identity. */
export function startRoom(room: Room, socketId: string): void {
  if (room.socketToPlayer.get(socketId) !== 0)
    throw new Error("Only the room creator can start the game.");
  if (room.started) throw new Error("The game has already started.");
  const connected = new Set(room.socketToPlayer.values());
  if (room.game.players.length !== room.size || connected.size !== room.size) {
    throw new Error("Wait until all players have joined and are connected.");
  }
  room.started = true;
}

export function rateLimit(room: Room, socketId: string, ms = 400): boolean {
  const now = Date.now();
  const last = room.lastAction.get(socketId) ?? 0;
  if (now - last < ms) return false;
  room.lastAction.set(socketId, now);
  return true;
}

/** Called on timeout — mutates room.game, returns true if changed. */
export function onTurnTimeout(room: Room): boolean {
  const g = room.game;
  if (!room.started || g.stage === "game-over" || g.players.length < room.size)
    return false;
  try {
    if (g.stage === "await-roll") {
      const { state } = applyRoll(g, g.turnIdx, secureDice());
      room.game = state;
      return true;
    }
    if (g.stage === "await-move" && g.dice != null) {
      const moves = getLegalMoves(g, g.turnIdx, g.dice);
      const pick = moves[Math.floor(Math.random() * moves.length)];
      if (pick === undefined) return false;
      const { state } = applyMove(g, g.turnIdx, pick, g.dice);
      room.game = state;
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function resetDeadline(room: Room, onTimeout: () => void) {
  room.turnDeadline = Date.now() + TURN_MS;
  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(onTimeout, TURN_MS);
  (room.timer as unknown as { unref?: () => void }).unref?.();
}

/** The server handles forced moves, even when the active player's tab is disconnected. */
export function scheduleOnlyMove(
  room: Room,
  onMoved: (result: MoveResult, playerIdx: number, tokenIdx: number) => void,
): void {
  if (room.autoMoveTimer) clearTimeout(room.autoMoveTimer);
  room.autoMoveTimer = undefined;
  const snapshot = room.game;
  const tokenIdx = getOnlyLegalMove(snapshot);
  if (!room.started || tokenIdx === null) return;
  room.autoMoveTimer = setTimeout(() => {
    room.autoMoveTimer = undefined;
    // A manual move or a newer turn invalidates this scheduled action.
    if (
      !room.started ||
      room.game !== snapshot ||
      getOnlyLegalMove(room.game) !== tokenIdx
    )
      return;
    const result = applyMove(
      snapshot,
      snapshot.turnIdx,
      tokenIdx,
      snapshot.dice!,
    );
    room.game = result.state;
    onMoved(result, snapshot.turnIdx, tokenIdx);
  }, DICE_ROLL_MS + AUTO_MOVE_PAUSE_MS);
  room.autoMoveTimer.unref?.();
}
