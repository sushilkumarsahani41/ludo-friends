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
    expect(() => addPlayer(room, "Extra", "extra")).toThrow("ROOM_FULL");
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
    room.game.players[0].tokens[0] = 56;
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
    room.game.players[0].tokens = [56, 57, 57, 57];
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
