"use client";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL } from "@/lib/socket-protocol";
import type { LudoGameState, LudoColor } from "@/lib/ludo-engine";
type RoomState = LudoGameState & {
  turnDeadline?: number;
  size?: number;
  started: boolean;
  connectedPlayers: number[];
};
export function useGameSocket(
  roomId: string,
  name: string,
  enabled = true,
  joinRequested = true,
  color?: LudoColor,
) {
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const [connected, setConnected] = useState(false);
  const [preview, setPreview] = useState<{
    size: number;
    started: boolean;
    players: { name: string; color: LudoColor }[];
  } | null>(null);
  const [game, setGame] = useState<RoomState | null>(null);
  const [myIdx, setMyIdx] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const socket = io(SOCKET_URL, { timeout: 6000, reconnectionAttempts: 5 });
    socketRef.current = socket;
    const add = (message: string) =>
      setEvents((prev) => [message, ...prev].slice(0, 20));
    socket.on("connect", () => {
      setConnected(true);
      setError(null);
      socket.emit("watch-room", { roomId });
      if (joinRequested)
        socket.emit("join-room", {
          roomId,
          name,
          color,
          playerId: localStorage.getItem(`ludo-pid-${roomId}`) || undefined,
        });
    });
    socket.on("disconnect", () => {
      setConnected(false);
    });
    socket.on("connect_error", () => {
      setConnected(false);
      setError("Can’t reach the table. Check your connection and try again.");
    });
    socket.on(
      "room-created",
      ({ playerId, playerIdx }: { playerId: string; playerIdx: number }) => {
        localStorage.setItem(`ludo-pid-${roomId}`, playerId);
        setMyIdx(playerIdx);
        setError(null);
      },
    );
    socket.on("room-info", setPreview);
    socket.on("room-state", (state: RoomState) => {
      setGame(state);
      setError(null);
    });
    socket.on(
      "dice-rolled",
      ({
        player,
        value,
        forfeited,
      }: {
        player: string;
        value: number;
        forfeited?: boolean;
      }) => {
        add(
          `${player} rolled ${value}${forfeited ? " · three sixes, turn passed" : ""}`,
        );
      },
    );
    socket.on(
      "token-moved",
      ({
        player,
        captured,
        extraTurn,
        automatic,
      }: {
        player: string;
        captured: unknown[];
        extraTurn: boolean;
        automatic?: boolean;
      }) =>
        add(
          `${player}${automatic ? " automatically moved" : " moved"}${captured.length ? " · captured a token!" : ""}${extraTurn ? " · roll again" : ""}`,
        ),
    );
    socket.on("error", ({ message }: { message: string }) =>
      setError(
        message === "ROOM_FULL"
          ? "This table is full. Ask your friends to create a new room."
          : message,
      ),
    );
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, name, enabled, joinRequested, color]);
  return {
    connected,
    preview,
    game,
    myIdx,
    error,
    events,
    selectColor: (color: LudoColor) =>
      socketRef.current?.emit("select-color", { roomId, color }),
    start: () => socketRef.current?.emit("start-game", { roomId }),
    roll: () => socketRef.current?.emit("roll-dice", { roomId }),
    move: (tokenIdx: number) =>
      socketRef.current?.emit("move-token", { roomId, tokenIdx }),
  };
}
