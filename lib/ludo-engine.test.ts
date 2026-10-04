import { describe, it, expect } from "vitest";
import {
  createGame,
  applyRoll,
  applyMove,
  getLegalMoves,
  absoluteCell,
  isSafeAbsolute,
  FINISHED,
} from "./ludo-engine";

function twoPlayer() {
  return createGame("TEST01", [
    { color: "red", name: "A" },
    { color: "green", name: "B" },
  ]);
}

describe("ludo-engine", () => {
  it("needs 6 to leave yard", () => {
    const g = twoPlayer();
    const { state } = applyRoll(g, 0, 3);
    // 3 with all in yard -> auto pass to next player
    expect(state.turnIdx).toBe(1);
  });

  it("6 leaves yard with extra turn chain", () => {
    const g = twoPlayer();
    const r = applyRoll(g, 0, 6);
    expect(r.state.stage).toBe("await-move");
    expect(getLegalMoves(r.state, 0, 6)).toEqual([0, 1, 2, 3]);
    const m = applyMove(r.state, 0, 0, 6);
    expect(m.state.players[0].tokens[0]).toBe(0);
    expect(m.extraTurn).toBe(true);
    expect(m.state.turnIdx).toBe(0); // extra turn stays
  });

  it("three sixes forfeit turn", () => {
    const g = twoPlayer();
    // force consecutiveSixes to 2 then roll 6
    g.players[0].consecutiveSixes = 2;
    g.stage = "await-roll";
    const r = applyRoll(g, 0, 6);
    expect(r.forfeited).toBe(true);
    expect(r.state.turnIdx).toBe(1);
  });

  it("capture sends victim to yard + extra turn", () => {
    const g = twoPlayer();
    // red token at steps 5 (abs 5), green token positioned to land on abs 5
    // green start offset 13 -> to reach abs 5 needs steps (5-13 mod52)=44
    g.players[0].tokens = [5, -1, -1, -1];
    g.players[1].tokens = [43, -1, -1, -1]; // abs (13+43)%52=4
    g.turnIdx = 1;
    g.stage = "await-roll";
    const r = applyRoll(g, 1, 1); // 43+1=44 -> abs 5 captures red
    expect(r.state.stage).toBe("await-move");
    const m = applyMove(r.state, 1, 0, 1);
    expect(m.captured.length).toBe(1);
    expect(m.state.players[0].tokens[0]).toBe(-1);
    expect(m.extraTurn).toBe(true);
  });

  it("safe cell prevents capture", () => {
    const g = twoPlayer();
    // abs 8 is safe. red at abs 8 -> steps 8. green lands on abs 8.
    g.players[0].tokens = [8, -1, -1, -1];
    // green steps for abs 8: (8-13 mod52)=47
    g.players[1].tokens = [46, -1, -1, -1]; // abs 7
    g.turnIdx = 1;
    g.stage = "await-roll";
    const r = applyRoll(g, 1, 1);
    const m = applyMove(r.state, 1, 0, 1);
    expect(m.captured.length).toBe(0);
    expect(m.state.players[0].tokens[0]).toBe(8);
  });

  it("needs exact roll to finish", () => {
    const g = twoPlayer();
    g.players[0].tokens = [56, 57, 57, 57];
    g.turnIdx = 0;
    g.stage = "await-roll";
    const r = applyRoll(g, 0, 2); // 56+2=58 >57 -> no legal moves -> auto pass
    expect(r.state.turnIdx).toBe(1);
  });

  it("finishing all tokens wins", () => {
    const g = twoPlayer();
    g.players[0].tokens = [56, 57, 57, 57];
    g.turnIdx = 0;
    g.stage = "await-roll";
    const r = applyRoll(g, 0, 1);
    const m = applyMove(r.state, 0, 0, 1);
    expect(m.state.players[0].tokens[0]).toBe(FINISHED);
    expect(m.state.stage).toBe("game-over");
    expect(m.state.winner).toBe("red");
  });

  it("absoluteCell + safe helpers", () => {
    expect(absoluteCell("red", 0)).toBe(0);
    expect(absoluteCell("green", 0)).toBe(13);
    expect(absoluteCell("red", 51)).toBeNull();
    expect(isSafeAbsolute(0)).toBe(true);
    expect(isSafeAbsolute(1)).toBe(false);
  });
});
