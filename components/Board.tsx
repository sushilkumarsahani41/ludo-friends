"use client";
import type { CSSProperties } from "react";
import { TRACK_COORDS, HOME_STRETCH, FINISH_STACKS } from "@/lib/board-coords";
import {
  COLORS,
  FINISHED,
  SAFE_CELLS,
  START_OFFSET,
  absoluteCell,
  type LudoColor,
  type LudoGameState,
} from "@/lib/ludo-engine";

export const PLAYER_COLORS: Record<LudoColor, string> = {
  red: "#f04458",
  green: "#17b978",
  yellow: "#ffc336",
  blue: "#4185ff",
};
const YARDS: Record<LudoColor, [number, number][]> = {
  red: [
    [1.7, 1.7],
    [1.7, 3.3],
    [3.3, 1.7],
    [3.3, 3.3],
  ],
  green: [
    [1.7, 10.7],
    [1.7, 12.3],
    [3.3, 10.7],
    [3.3, 12.3],
  ],
  yellow: [
    [10.7, 10.7],
    [10.7, 12.3],
    [12.3, 10.7],
    [12.3, 12.3],
  ],
  blue: [
    [10.7, 1.7],
    [10.7, 3.3],
    [12.3, 1.7],
    [12.3, 3.3],
  ],
};
function position(r: number, c: number): CSSProperties {
  return { left: `${(c / 15) * 100}%`, top: `${(r / 15) * 100}%` };
}
export default function Board({
  game,
  legalMoves = [],
  onTokenClick,
  preview = false,
  movingToken = null,
  returningTokens = [],
  active = true,
}: {
  game: LudoGameState;
  legalMoves?: number[];
  onTokenClick?: (index: number) => void;
  preview?: boolean;
  movingToken?: string | null;
  returningTokens?: string[];
  active?: boolean;
}) {
  const occupied = new Map<string, number>();
  return (
    <div className={`board-frame ${preview ? "board-preview" : ""}`}>
      <div className="ludo-board" role="group" aria-label="Ludo board">
        {COLORS.map((color, i) => (
          <div
            key={color}
            className={`board-yard ${!preview && active && game.players[game.turnIdx]?.color === color ? "active-yard" : ""}`}
            style={
              {
                ...position(i < 2 ? 0 : 9, i === 1 || i === 2 ? 9 : 0),
                "--player-color": PLAYER_COLORS[color],
              } as CSSProperties
            }
          >
            {!preview && active && game.players[game.turnIdx]?.color === color && (
              <span className="yard-turn-badge">Playing now</span>
            )}
            <div className="yard-inner">
              {[0, 1, 2, 3].map((n) => (
                <span key={n} className="yard-socket" />
              ))}
            </div>
            <span className="yard-label">
              {game.players.find((p) => p.color === color)?.name ?? color}
            </span>
          </div>
        ))}
        {TRACK_COORDS.map(([r, c], i) => {
          const color = COLORS.find((color) => START_OFFSET[color] === i);
          return (
            <div
              key={i}
              className={`track-cell ${SAFE_CELLS.has(i) ? "safe-cell" : ""}`}
              style={{
                ...position(r, c),
                ...(color
                  ? { background: PLAYER_COLORS[color], color: "white" }
                  : {}),
              }}
            >
              {SAFE_CELLS.has(i) ? "✦" : ""}
            </div>
          );
        })}
        {COLORS.map((color) =>
          HOME_STRETCH[color].map(([r, c], i) => (
            <div
              key={`${color}-${i}`}
              className="track-cell home-cell"
              style={
                {
                  ...position(r, c),
                  "--player-color": PLAYER_COLORS[color],
                } as CSSProperties
              }
            >
              {i === 0 ? (
                <span className={`home-arrow arrow-${color}`}>›</span>
              ) : null}
            </div>
          )),
        )}
        <div className="board-center">
          {!game.players.some((p) => p.tokens.includes(FINISHED)) && (
            <span>✦</span>
          )}
        </div>
        {game.players.flatMap((player, pi) =>
          player.tokens.map((steps, ti) => {
            let r: number, c: number;
            if (steps === -1) [r, c] = YARDS[player.color][ti];
            else if (steps <= 50)
              [r, c] = TRACK_COORDS[absoluteCell(player.color, steps)!];
            else if (steps <= 55)
              [r, c] = HOME_STRETCH[player.color][steps - 51];
            else {
              [r, c] = FINISH_STACKS[player.color];
            }
            const key = `${r}-${c}`;
            const count = occupied.get(key) ?? 0;
            occupied.set(key, count + 1);
            const movable =
              !preview &&
              pi === game.turnIdx &&
              legalMoves.includes(ti) &&
              steps !== FINISHED;
            const style = {
              left: `${((c + 0.5) / 15) * 100 + (steps === FINISHED ? 0 : (count % 2) * 1.3)}%`,
              top: `${((r + 0.5) / 15) * 100 + (steps === FINISHED ? -count * 0.42 : Math.floor(count / 2) * 1.3)}%`,
              "--player-color": PLAYER_COLORS[player.color],
              zIndex: 5 + count,
            } as CSSProperties;
            return (
              <button
                key={`${player.color}-${ti}`}
                data-token={`${player.color}-${ti}`}
                data-step={steps}
                className={`board-token ${returningTokens.includes(`${player.color}-${ti}`) ? "returning" : ""} ${movingToken === `${player.color}-${ti}` ? "stepping" : ""} ${movable ? "movable" : ""} ${steps === FINISHED ? "finished-token" : ""}`}
                style={style}
                disabled={!movable}
                onClick={() => onTokenClick?.(ti)}
                aria-label={`${player.name}, ${player.color} token ${ti + 1}${steps === FINISHED ? ", home" : movable ? ", move" : ""}`}
              >
                <span>{steps === FINISHED ? count + 1 : ""}</span>
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
