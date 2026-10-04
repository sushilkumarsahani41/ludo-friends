import { describe, expect, it } from "vitest";
import { availableColors } from "./room-colors";
import { COLORS, colorsForPlayers, START_OFFSET } from "./ludo-engine";

describe("available room colors", () => {
  it.each(COLORS)("keeps %s opposite its partner", (color) => {
    const pair = colorsForPlayers(2, color);
    expect(pair[0]).toBe(color);
    expect(Math.abs(START_OFFSET[pair[0]] - START_OFFSET[pair[1]])).toBe(26);
    expect(availableColors(2, [{ color }])).toEqual([pair[1]]);
  });
  it("removes all occupied colors when joining", () => {
    expect(availableColors(4, [{ color: "red" }, { color: "blue" }])).toEqual([
      "green",
      "yellow",
    ]);
  });
  it("keeps your own color selectable while disabling other players' colors", () => {
    expect(
      availableColors(3, [{ color: "red" }, { color: "green" }], 1),
    ).toEqual(["green", "yellow", "blue"]);
  });
});
