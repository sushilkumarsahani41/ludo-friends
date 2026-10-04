import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMove, applyRoll, getOnlyLegalMove } from "../lib/ludo-engine";
import { AUTO_MOVE_PAUSE_MS, DICE_ROLL_MS } from "../lib/game-feedback";
import {
  addPlayer,
  getOrCreateRoom,
  onTurnTimeout,
  rooms,
  startRoom,
  scheduleOnlyMove,
  selectPlayerColor,
  removePlayer,
  voteToKick,
  recordPlayerAction,
  resetDeadline,
} from "./game-store";

afterEach(() => {
  for (const room of rooms.values()) {
    if (room.timer) clearTimeout(room.timer);
    if (room.autoMoveTimer) clearTimeout(room.autoMoveTimer);
  }
  vi.useRealTimers();
  rooms.clear();
});
function fullRoom(size = 2) {
  const room = getOrCreateRoom("ROOM01", size);
  for (let i = 0; i < size; i++) {
    addPlayer(room, `Player ${i}`, `pid-${i}`);
    room.socketToPlayer.set(`socket-${i}`, i);
  }
  return room;
}
describe("room lobby", () => {
  it("seats two players in opposite red and yellow yards", () => {
    expect(fullRoom().game.players.map((p) => p.color)).toEqual([
      "red",
      "yellow",
    ]);
  });
  it("retains all four colors for a four-player game", () => {
    expect(fullRoom(4).game.players.map((p) => p.color)).toEqual([
      "red",
      "green",
      "yellow",
      "blue",
    ]);
  });
  it("does not auto-start or advance a full lobby", () => {
    const room = fullRoom();
    const before = structuredClone(room.game);
    expect(room.started).toBe(false);
    expect(room.turnDeadline).toBe(0);
    expect(onTurnTimeout(room)).toBe(false);
    expect(room.game).toEqual(before);
  });
  it("rejects non-host and unknown sockets", () => {
    const room = fullRoom();
    expect(() => startRoom(room, "socket-1")).toThrow("Only the room creator");
    expect(() => startRoom(room, "stranger")).toThrow("Only the room creator");
    expect(room.started).toBe(false);
  });
  it("requires every selected seat to be joined and connected", () => {
    const room = getOrCreateRoom("ROOM01", 2);
    addPlayer(room, "Host", "host");
    room.socketToPlayer.set("host-socket", 0);
    expect(() => startRoom(room, "host-socket")).toThrow("all players");
    addPlayer(room, "Friend", "friend");
    expect(() => startRoom(room, "host-socket")).toThrow("all players");
    room.socketToPlayer.set("friend-socket", 1);
    startRoom(room, "host-socket");
    expect(room.started).toBe(true);
    expect(onTurnTimeout(room)).toBe(true);
    expect(() => startRoom(room, "host-socket")).toThrow("already started");
  });
  it("preserves the host seat after reconnection", () => {
    const room = fullRoom();
    room.socketToPlayer.delete("socket-0");
    const index = addPlayer(room, "Player 0", "pid-0");
    room.socketToPlayer.set("reconnected", index);
    expect(index).toBe(0);
    expect(room.game.players).toHaveLength(2);
    startRoom(room, "reconnected");
    expect(room.started).toBe(true);
    expect(() => addPlayer(room, "Extra", "extra")).toThrow("already started");
  });
});

describe("single legal move automation", () => {
  it("waits for the dice reveal, then moves the only legal goti once", () => {
    vi.useFakeTimers();
    const room = fullRoom();
    room.started = true;
    room.game.players[0].tokens[2] = 4;
    room.game = applyRoll(room.game, 0, 3).state;
    expect(getOnlyLegalMove(room.game)).toBe(2);
    const onMoved = vi.fn();
    scheduleOnlyMove(room, onMoved);
    vi.advanceTimersByTime(DICE_ROLL_MS + AUTO_MOVE_PAUSE_MS - 1);
    expect(room.game.players[0].tokens[2]).toBe(4);
    vi.advanceTimersByTime(1);
    expect(room.game.players[0].tokens[2]).toBe(7);
    expect(onMoved).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(onMoved).toHaveBeenCalledTimes(1);
  });
  it("leaves multiple legal tokens for the player to choose", () => {
    vi.useFakeTimers();
    const room = fullRoom();
    room.started = true;
    room.game = applyRoll(room.game, 0, 6).state;
    expect(getOnlyLegalMove(room.game)).toBeNull();
    const onMoved = vi.fn();
    scheduleOnlyMove(room, onMoved);
    vi.runAllTimers();
    expect(onMoved).not.toHaveBeenCalled();
    expect(room.game.stage).toBe("await-move");
  });
  it("does nothing when there is no legal move or the room has not started", () => {
    vi.useFakeTimers();
    const room = fullRoom();
    room.game.players[0].tokens[0] = 55;
    room.game = applyRoll(room.game, 0, 2).state;
    expect(getOnlyLegalMove(room.game)).toBeNull();
    const onMoved = vi.fn();
    scheduleOnlyMove(room, onMoved);
    room.game.turnIdx = 0;
    room.game.stage = "await-roll";
    room.game = applyRoll(room.game, 0, 1).state;
    expect(getOnlyLegalMove(room.game)).toBe(0);
    scheduleOnlyMove(room, onMoved);
    vi.runAllTimers();
    expect(onMoved).not.toHaveBeenCalled();
  });
  it("does not apply a stale automatic move after a manual move", () => {
    vi.useFakeTimers();
    const room = fullRoom();
    room.started = true;
    room.game.players[0].tokens[0] = 1;
    room.game = applyRoll(room.game, 0, 4).state;
    const onMoved = vi.fn();
    scheduleOnlyMove(room, onMoved);
    room.game = applyMove(room.game, 0, 0, 4).state;
    const after = room.game;
    vi.runAllTimers();
    expect(room.game).toBe(after);
    expect(onMoved).not.toHaveBeenCalled();
  });
  it("automatically captures and preserves the earned extra roll", () => {
    vi.useFakeTimers();
    const room = fullRoom();
    room.started = true;
    room.game.players[0].tokens[0] = 1;
    room.game.players[1].tokens[0] = 31;
    room.game = applyRoll(room.game, 0, 4).state;
    const onMoved = vi.fn();
    scheduleOnlyMove(room, onMoved);
    vi.runAllTimers();
    expect(room.game.players[1].tokens[0]).toBe(-1);
    expect(room.game.turnIdx).toBe(0);
    expect(room.game.stage).toBe("await-roll");
    expect(onMoved.mock.calls[0][0].captured).toEqual([
      { color: "yellow", tokenIdx: 0 },
    ]);
  });
  it("automatically finishes the last goti on an exact roll", () => {
    vi.useFakeTimers();
    const room = fullRoom();
    room.started = true;
    room.game.players[0].tokens = [55, 56, 56, 56];
    room.game = applyRoll(room.game, 0, 1).state;
    scheduleOnlyMove(room, vi.fn());
    vi.runAllTimers();
    expect(room.game.stage).toBe("game-over");
    expect(room.game.winner).toBe("red");
  });
});

describe("room color selection", () => {
  it("honors the creator color and assigns the opposite color in two-player rooms", () => {
    const room = getOrCreateRoom("COLORS", 2);
    addPlayer(room, "Host", "host", "green");
    addPlayer(room, "Friend", "friend");
    expect(room.game.players.map((p) => p.color)).toEqual(["green", "blue"]);
  });
  it("rejects a taken color without consuming a seat", () => {
    const room = getOrCreateRoom("COLORS", 4);
    addPlayer(room, "Host", "host", "blue");
    expect(() => addPlayer(room, "Friend", "friend", "blue")).toThrow(
      "unavailable",
    );
    expect(room.game.players).toHaveLength(1);
    expect(room.playerIdToIdx.has("friend")).toBe(false);
    addPlayer(room, "Friend", "friend", "yellow");
    expect(room.game.players[1].color).toBe("yellow");
  });
  it("rejects adjacent colors in two-player rooms", () => {
    const room = getOrCreateRoom("COLORS", 2);
    addPlayer(room, "Host", "host", "yellow");
    expect(() => addPlayer(room, "Friend", "friend", "green")).toThrow(
      "unavailable",
    );
    addPlayer(room, "Friend", "friend", "red");
    expect(room.game.players[1].color).toBe("red");
  });
  it("allows a lobby color change and releases the previous color", () => {
    const room = fullRoom(3);
    selectPlayerColor(room, "socket-0", "blue");
    expect(room.game.players[0].color).toBe("blue");
    selectPlayerColor(room, "socket-1", "red");
    expect(room.game.players[1].color).toBe("red");
    expect(() => selectPlayerColor(room, "socket-2", "red")).toThrow(
      "unavailable",
    );
  });
  it("rejects unknown players and locks colors after start", () => {
    const room = fullRoom(3);
    expect(() => selectPlayerColor(room, "unknown", "blue")).toThrow(
      "Join the room",
    );
    startRoom(room, "socket-0");
    expect(() => selectPlayerColor(room, "socket-0", "blue")).toThrow("locked");
    expect(room.game.players[0].color).toBe("red");
  });
  it("preserves a player's chosen color on reconnect", () => {
    const room = fullRoom(3);
    selectPlayerColor(room, "socket-0", "blue");
    expect(addPlayer(room, "Host", "pid-0", "red")).toBe(0);
    expect(room.game.players[0].color).toBe("blue");
  });
});

describe("leaving, voting and missed turns", () => {
  it("transfers lobby hosting, remaps reconnect identities and keeps the empty seat available", () => {
    const room = fullRoom(3);
    removePlayer(room, 0, "Left");
    expect(room.socketToPlayer.get("socket-1")).toBe(0);
    expect(addPlayer(room, "Again", "pid-1")).toBe(0);
    expect(room.size).toBe(3);
    expect(() => addPlayer(room, "Removed", "pid-0")).toThrow("removed");
    addPlayer(room, "New", "new");
    room.socketToPlayer.set("new-socket", 2);
    startRoom(room, "socket-1");
    expect(room.started).toBe(true);
  });
  it("continues with the next remaining player when the current player leaves", () => {
    const room = fullRoom(4);
    room.started = true;
    room.game.turnIdx = 1;
    room.game.stage = "await-move";
    room.game.dice = 4;
    removePlayer(room, 1, "Left");
    expect(room.game.players[room.game.turnIdx].color).toBe("yellow");
    expect(room.game.stage).toBe("await-roll");
    expect(room.game.dice).toBeNull();
    expect(room.size).toBe(3);
    expect(() => addPlayer(room, "New", "new")).toThrow("already started");
  });
  it("preserves a different player's roll when an earlier seat leaves", () => {
    const room = fullRoom(4);
    room.started = true;
    room.game.turnIdx = 2;
    room.game.stage = "await-move";
    room.game.dice = 3;
    removePlayer(room, 0, "Left");
    expect(room.game.turnIdx).toBe(1);
    expect(room.game.players[1].color).toBe("yellow");
    expect(room.game.dice).toBe(3);
    expect(room.game.stage).toBe("await-move");
  });
  it("awards the remaining player the game and clears timers", () => {
    vi.useFakeTimers();
    const room = fullRoom();
    room.started = true;
    resetDeadline(room, vi.fn());
    removePlayer(room, 0, "Left");
    expect(room.game.stage).toBe("game-over");
    expect(room.game.winner).toBe("yellow");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("requires two distinct other players, blocks outsiders and self votes", () => {
    const room = fullRoom(4);
    expect(() => voteToKick(room, "outsider", 0)).toThrow("Join");
    expect(() => voteToKick(room, "socket-0", 0)).toThrow("another");
    expect(voteToKick(room, "socket-0", 3)).toBe(false);
    expect(voteToKick(room, "socket-0", 3)).toBe(false);
    expect(room.kickVote?.voters).toEqual([0]);
    expect(() => voteToKick(room, "socket-1", 2)).toThrow("current vote");
    expect(voteToKick(room, "socket-1", 3)).toBe(true);
    expect(room.game.players).toHaveLength(3);
    expect(room.playerIdToIdx.has("pid-3")).toBe(false);
    expect(room.removals[0].socketIds).toEqual(["socket-3"]);
    expect(room.kickVote).toBeUndefined();
  });
  it("does not allow one opponent to kick the other in two-player games", () => {
    expect(() => voteToKick(fullRoom(), "socket-0", 1)).toThrow(
      "three players",
    );
  });
  it("expires votes and clears them when a seat leaves", () => {
    vi.useFakeTimers();
    const room = fullRoom(4);
    voteToKick(room, "socket-0", 3);
    vi.advanceTimersByTime(60001);
    expect(voteToKick(room, "socket-1", 3)).toBe(false);
    expect(room.kickVote?.voters).toEqual([1]);
    removePlayer(room, 0, "Left");
    expect(room.kickVote).toBeUndefined();
  });
  it("removes only on the fifth consecutive timeout and keeps other players' counts", () => {
    const room = fullRoom(3);
    room.started = true;
    room.game.players[1].missedTurns = 2;
    for (let miss = 1; miss <= 5; miss++) {
      room.game = { ...room.game, turnIdx: 0, stage: "await-move", dice: 1 };
      room.game.players[0].tokens[0] = 1;
      expect(onTurnTimeout(room)).toBe(true);
      if (miss < 5) {
        expect(room.game.players[0].missedTurns).toBe(miss);
        expect(room.game.players).toHaveLength(3);
      }
    }
    expect(room.game.players.map((p) => p.color)).toEqual(["green", "yellow"]);
    expect(room.game.players[0].missedTurns).toBe(2);
    expect(room.removals[0].reason).toContain("five consecutive");
  });
  it("resets the streak on a real action and does not count forced moves", () => {
    vi.useFakeTimers();
    const room = fullRoom();
    room.started = true;
    room.game.players[0].missedTurns = 4;
    recordPlayerAction(room, 0);
    expect(room.game.players[0].missedTurns).toBe(0);
    room.game.players[0].tokens[0] = 2;
    room.game = applyRoll(room.game, 0, 2).state;
    scheduleOnlyMove(room, vi.fn());
    vi.runAllTimers();
    expect(room.game.players[0].missedTurns).toBe(0);
  });
  it("invalidates queued automatic movement when a player leaves", () => {
    vi.useFakeTimers();
    const room = fullRoom(3);
    room.started = true;
    room.game.players[0].tokens[0] = 2;
    room.game = applyRoll(room.game, 0, 3).state;
    const moved = vi.fn();
    scheduleOnlyMove(room, moved);
    removePlayer(room, 0, "Left");
    vi.runAllTimers();
    expect(moved).not.toHaveBeenCalled();
  });
});
