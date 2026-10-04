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
  removedIds: Set<string>;
  removals: {
    playerIds: string[];
    socketIds: string[];
    name: string;
    reason: string;
  }[];
  kickVote?: { target: number; voters: number[]; expiresAt: number };
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
      removedIds: new Set(),
      removals: [],
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
  if (room.removedIds.has(playerId))
    throw new Error("You have left or been removed from this table.");
  const existing = room.playerIdToIdx.get(playerId);
  if (existing !== undefined) return existing;
  if (room.started) throw new Error("This game has already started.");
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

/** Remove a seat and remap identities without changing the remaining colors. */
export function removePlayer(room: Room, index: number, reason: string): void {
  const leaving = room.game.players[index];
  if (!leaving) throw new Error("Player not found.");
  const playerIds: string[] = [],
    socketIds: string[] = [];
  for (const [id, seat] of room.playerIdToIdx) {
    if (seat === index) {
      playerIds.push(id);
      room.removedIds.add(id);
      room.playerIdToIdx.delete(id);
    } else if (seat > index) room.playerIdToIdx.set(id, seat - 1);
  }
  for (const [id, seat] of room.socketToPlayer) {
    if (seat === index) {
      socketIds.push(id);
      room.socketToPlayer.delete(id);
      room.lastAction.delete(id);
    } else if (seat > index) room.socketToPlayer.set(id, seat - 1);
  }
  const previous = room.game;
  const players = previous.players.filter((_, i) => i !== index);
  const rank = previous.rank.filter((color) => color !== leaving.color);
  let turnIdx = previous.turnIdx - (index < previous.turnIdx ? 1 : 0);
  const lostTurn = index === previous.turnIdx;
  if (lostTurn && players.length) {
    turnIdx = index % players.length;
    for (let n = 0; n < players.length && players[turnIdx].finished; n++)
      turnIdx = (turnIdx + 1) % players.length;
  }
  const active = players.filter((p) => !p.finished);
  const ended =
    room.started && (active.length <= 1 || previous.stage === "game-over");
  room.game = {
    ...previous,
    players,
    rank,
    turnIdx: players.length ? turnIdx : 0,
    stage: ended ? "game-over" : lostTurn ? "await-roll" : previous.stage,
    dice: lostTurn || ended ? null : previous.dice,
    winner: ended
      ? (rank[0] ?? active[0]?.color ?? players[0]?.color)
      : undefined,
  };
  if (room.started) room.size = players.length;
  room.kickVote = undefined;
  if (room.autoMoveTimer) clearTimeout(room.autoMoveTimer);
  room.autoMoveTimer = undefined;
  room.removals.push({ playerIds, socketIds, name: leaving.name, reason });
  if (!players.length || ended) {
    if (room.timer) clearTimeout(room.timer);
    room.turnDeadline = 0;
  }
}

export function voteToKick(
  room: Room,
  socketId: string,
  target: number,
): boolean {
  const voter = room.socketToPlayer.get(socketId);
  if (voter === undefined) throw new Error("Join the table before voting.");
  if (
    !Number.isInteger(target) ||
    !room.game.players[target] ||
    target === voter
  )
    throw new Error("Choose another player.");
  if (room.game.players.length < 3 || room.game.stage === "game-over")
    throw new Error(
      "Voting needs at least three players and an unfinished game.",
    );
  if (room.kickVote && room.kickVote.expiresAt <= Date.now())
    room.kickVote = undefined;
  if (room.kickVote && room.kickVote.target !== target)
    throw new Error("Finish the current vote first.");
  room.kickVote ??= { target, voters: [], expiresAt: Date.now() + 60_000 };
  if (!room.kickVote.voters.includes(voter)) room.kickVote.voters.push(voter);
  const needed = Math.max(
    2,
    Math.floor((room.game.players.length - 1) / 2) + 1,
  );
  if (room.kickVote.voters.length >= needed) {
    removePlayer(room, target, "Removed by a player vote.");
    return true;
  }
  return false;
}

export function recordPlayerAction(room: Room, index: number): void {
  room.game = {
    ...room.game,
    players: room.game.players.map((p, i) =>
      i === index ? { ...p, missedTurns: 0 } : p,
    ),
  };
}

/** Each timeout counts once; automatic roll + move complete the missed opportunity. */
export function onTurnTimeout(room: Room): boolean {
  const g = room.game;
  if (!room.started || g.stage === "game-over" || g.players.length < 2)
    return false;
  const index = g.turnIdx;
  const misses = (g.players[index].missedTurns ?? 0) + 1;
  room.game = {
    ...g,
    players: g.players.map((p, i) =>
      i === index ? { ...p, missedTurns: misses } : p,
    ),
  };
  if (misses >= 5) {
    removePlayer(room, index, "Removed after five consecutive missed turns.");
    return true;
  }
  if (room.game.stage === "await-roll")
    room.game = applyRoll(room.game, index, secureDice()).state;
  if (
    room.game.stage === "await-move" &&
    room.game.turnIdx === index &&
    room.game.dice != null
  ) {
    const moves = getLegalMoves(room.game, index, room.game.dice);
    const pick = moves[Math.floor(Math.random() * moves.length)];
    if (pick !== undefined)
      room.game = applyMove(room.game, index, pick, room.game.dice).state;
  }
  return true;
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
