import type { LudoGameState, LudoColor } from "./ludo-engine";

// Socket protocol (client <-> server). Server is authoritative.
export interface ClientToServer {
  "create-room": { name: string; players: number; color?: LudoColor };
  "join-room": {
    roomId: string;
    name: string;
    playerId?: string;
    color?: LudoColor;
  };
  "watch-room": { roomId: string };
  "select-color": { roomId: string; color: LudoColor };
  "start-game": { roomId: string };
  "roll-dice": { roomId: string };
  "move-token": { roomId: string; tokenIdx: number };
}

export interface ServerToClient {
  "room-info": (room: {
    roomId: string;
    size: number;
    started: boolean;
    players: { name: string; color: LudoColor }[];
  }) => void;
  "room-state": (
    s: LudoGameState & {
      size: number;
      turnDeadline: number;
      started: boolean;
      connectedPlayers: number[];
    },
  ) => void;
  "dice-rolled": (p: {
    player: string;
    value: number;
    moves: number[];
    forfeited?: boolean;
  }) => void;
  "token-moved": (p: {
    player: string;
    tokenIdx: number;
    captured: unknown[];
    extraTurn: boolean;
    automatic?: boolean;
  }) => void;
  "room-created": (p: {
    roomId: string;
    playerId: string;
    playerIdx: number;
  }) => void;
  error: (p: { code: string; message: string }) => void;
}

export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  (typeof window !== "undefined" &&
  !["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? window.location.origin
    : "http://localhost:4001");
