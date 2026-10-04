import { describe, expect, it } from "vitest";
import { createGame, applyMove, colorsForPlayers } from "./ludo-engine";
import { CAPTURE_RETURN_MS, moveFrames } from "./move-animation";
function game() {
  const g = createGame(
    "TEST01",
    colorsForPlayers(2).map((color) => ({ color, name: color })),
  );
  g.stage = "await-move";
  return g;
}
describe("step-by-step token movement", () => {
  it("visits each square and then commits the authoritative state", () => {
    const before = game();
    before.players[0].tokens[0] = 3;
    const after = applyMove(before, 0, 0, 5).state;
    const frames = moveFrames(before, after);
    expect(frames.map((f) => f.game.players[0].tokens[0])).toEqual([
      4, 5, 6, 7, 8, 8,
    ]);
    expect(frames.at(-1)?.game).toBe(after);
    expect(before.players[0].tokens[0]).toBe(3);
  });
  it("animates leaving the yard as one hop", () => {
    const before = game();
    const after = applyMove(before, 0, 0, 6).state;
    expect(
      moveFrames(before, after).map((f) => f.game.players[0].tokens[0]),
    ).toEqual([0, 0]);
  });
  it("keeps captured tokens in place until landing", () => {
    const before = game();
    before.players[0].tokens[0] = 1;
    before.players[1].tokens[0] = 31;
    const after = applyMove(before, 0, 0, 4).state; // yellow 31 + offset 26 = absolute 5
    const frames = moveFrames(before, after);
    expect(
      frames
        .filter((f) => f.movingToken)
        .every((f) => f.game.players[1].tokens[0] === 31),
    ).toBe(true);
    const returning = frames.find((f) => f.returningTokens?.length);
    expect(returning?.returningTokens).toEqual(["yellow-0"]);
    expect(returning?.durationMs).toBe(CAPTURE_RETURN_MS);
    expect(returning?.game.players[1].tokens[0]).toBe(-1);
    expect(returning?.game.stage).toBe("await-move");
    expect(frames.at(-1)?.game).toBe(after);
    expect(frames.at(-1)?.returningTokens).toBeUndefined();
    expect(frames.at(-1)?.game.players[1].tokens[0]).toBe(-1);
  });
  it("follows the home stretch and finishes before announcing a win", () => {
    const before = game();
    before.players[0].tokens = [52, 57, 57, 57];
    const after = applyMove(before, 0, 0, 5).state;
    const frames = moveFrames(before, after);
    expect(frames.map((f) => f.game.players[0].tokens[0])).toEqual([
      53, 54, 55, 56, 57, 57,
    ]);
    expect(frames.slice(0, -1).every((f) => f.game.stage !== "game-over")).toBe(
      true,
    );
    expect(frames.at(-1)?.game.stage).toBe("game-over");
  });
  it("snaps to a reconnect snapshot instead of replaying a whole game", () => {
    const before = game();
    const after = structuredClone(before);
    after.players[0].tokens[0] = 40;
    expect(moveFrames(before, after)).toEqual([
      { game: after, movingToken: null },
    ]);
    expect(moveFrames(null, after)).toEqual([
      { game: after, movingToken: null },
    ]);
  });
});
