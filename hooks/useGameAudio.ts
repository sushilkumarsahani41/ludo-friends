"use client";
import { useCallback, useEffect, useState } from "react";
import { GameAudio, type GameSound } from "@/lib/game-audio";

export function useGameAudio() {
  const [audio] = useState(() => new GameAudio());
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem("ludo-sounds-muted") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    audio.setMuted(muted);
  }, [audio, muted]);
  useEffect(() => {
    const unlock = () => audio.unlock();
    const hide = () => {
      if (document.visibilityState === "hidden") audio.stop();
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("visibilitychange", hide);
      audio.dispose();
    };
  }, [audio]);
  const play = useCallback((sound: GameSound) => audio.play(sound), [audio]);
  function toggle() {
    const next = !muted;
    audio.unlock();
    audio.setMuted(next);
    setMuted(next);
    try {
      localStorage.setItem("ludo-sounds-muted", String(next));
    } catch {
      /* storage is optional */
    }
  }
  return { muted, toggle, play };
}
