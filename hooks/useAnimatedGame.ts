"use client";
import { useEffect, useRef, useState } from "react";
import type { LudoGameState } from "@/lib/ludo-engine";
import {
  moveFrames,
  TOKEN_STEP_MS,
  type MoveFrame,
} from "@/lib/move-animation";
import { DICE_ROLL_MS, isNewRoll, moveSound } from "@/lib/game-feedback";
import type { GameSound } from "@/lib/game-audio";

/** Serialize roll reveals and token hops, including automatic server turns. */
export function useAnimatedGame(
  source: LudoGameState | null,
  playSound: (sound: GameSound) => void,
) {
  const [view, setView] = useState<{
    game: LudoGameState | null;
    movingToken: string | null;
    rolling: boolean;
    returningTokens: string[];
  }>({ game: source, movingToken: null, rolling: false, returningTokens: [] });
  const shown = useRef(source);
  const lastQueued = useRef(source);
  const queue = useRef<LudoGameState[]>([]);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!source || lastQueued.current === source) return;
    lastQueued.current = source;
    queue.current.push(source);
    function drain() {
      if (running.current) return;
      const next = queue.current.shift();
      if (!next) return;
      running.current = true;
      const previous = shown.current;
      const roll = isNewRoll(previous, next);
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const frames: MoveFrame[] = reducedMotion
        ? [{ game: next, movingToken: null }]
        : moveFrames(previous, next);
      const landingSound = moveSound(previous, next);
      let index = 0;
      let capturePlayed = false;
      function tick() {
        const frame = frames[index++];
        shown.current = frame.game;
        setView({
          ...frame,
          returningTokens: frame.returningTokens ?? [],
          rolling: false,
        });
        if (frame.returningTokens?.length) {
          playSound("capture");
          capturePlayed = true;
        }
        if (frame.movingToken) playSound("step");
        if (index < frames.length)
          timer.current = setTimeout(tick, frame.durationMs ?? TOKEN_STEP_MS);
        else {
          if (roll)
            playSound(
              next!.lastRoll?.value === 6 && !next!.lastRoll?.forfeited
                ? "six"
                : "land",
            );
          if (landingSound && !(landingSound === "capture" && capturePlayed))
            playSound(landingSound);
          running.current = false;
          drain();
        }
      }
      timer.current = setTimeout(() => {
        if (roll) {
          setView({
            game: previous,
            movingToken: null,
            returningTokens: [],
            rolling: true,
          });
          playSound("roll");
          timer.current = setTimeout(tick, DICE_ROLL_MS);
        } else tick();
      }, 0);
    }
    drain();
  }, [source, playSound]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      queue.current = [];
      running.current = false;
    },
    [],
  );
  return {
    ...view,
    animating:
      view.rolling ||
      view.movingToken !== null ||
      view.returningTokens.length > 0 ||
      view.game !== source,
  };
}
