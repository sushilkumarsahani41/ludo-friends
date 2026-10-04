import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyRoll,
  colorsForPlayers,
  createGame,
} from "./ludo-engine";
import { isNewRoll, moveSound } from "./game-feedback";
import {
  getOrCreateRoom,
  addPlayer,
  onTurnTimeout,
  rooms,
} from "../server/game-store";
function game() {
  return createGame(
    "SOUND1",
    colorsForPlayers(2).map((color) => ({ color, name: color })),
  );
}

describe("dice and sound feedback", () => {
  it("identifies each roll even when the same number is rolled and no move is possible", () => {
    const start = game();
    const first = applyRoll(start, 0, 2).state;
    const second = applyRoll(first, 1, 2).state;
    expect(first.dice).toBeNull();
    expect(first.lastRoll).toEqual({ id: 1, value: 2, player: "red" });
    expect(second.lastRoll?.id).toBe(2);
    expect(isNewRoll(start, first)).toBe(true);
    expect(isNewRoll(first, second)).toBe(true);
    expect(isNewRoll(first, { ...first })).toBe(false);
  });
  it("does not replay rolls for a fresh connection or a snapshot that skips multiple rolls", () => {
    const start = game();
    const first = applyRoll(start, 0, 2).state;
    const second = applyRoll(first, 1, 2).state;
    expect(isNewRoll(null, first)).toBe(false);
    expect(isNewRoll(start, second)).toBe(false);
  });
  it("keeps the rolled value through a move and identifies forfeited sixes", () => {
    const start = game();
    const roll = applyRoll(start, 0, 6).state;
    const moved = applyMove(roll, 0, 0, 6).state;
    expect(moved.lastRoll).toEqual(roll.lastRoll);
    expect(isNewRoll(roll, moved)).toBe(false);
    moved.players[0].consecutiveSixes = 2;
    expect(applyRoll(moved, 0, 6).state.lastRoll?.forfeited).toBe(true);
  });
  it("includes dice feedback for automatic server rolls", () => {
    const room = getOrCreateRoom("AUTO01", 2);
    addPlayer(room, "Host", "a");
    addPlayer(room, "Friend", "b");
    room.started = true;
    const before = room.game;
    expect(onTurnTimeout(room)).toBe(true);
    expect(isNewRoll(before, room.game)).toBe(true);
    expect(room.game.lastRoll?.value).toBeGreaterThanOrEqual(1);
    rooms.delete("AUTO01");
  });
  it("plays a capture cue only after the resulting state is committed", () => {
    const before = game();
    before.stage = "await-move";
    before.players[0].tokens[0] = 1;
    before.players[1].tokens[0] = 31;
    const after = applyMove(before, 0, 0, 4).state;
    expect(moveSound(before, after)).toBe("capture");
    expect(moveSound(after, after)).toBeNull();
  });
  it("distinguishes a token reaching home from the final winning token", () => {
    const before = game();
    before.stage = "await-move";
    before.players[0].tokens[0] = 55;
    expect(moveSound(before, applyMove(before, 0, 0, 1).state)).toBe("home");
    before.players[0].tokens = [55, 56, 56, 56];
    expect(moveSound(before, applyMove(before, 0, 0, 1).state)).toBe("win");
    expect(moveSound(null, before)).toBeNull();
  });
});
