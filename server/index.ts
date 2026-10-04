import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { nanoid } from "nanoid";
import {
  rooms,
  getOrCreateRoom,
  addPlayer,
  rateLimit,
  resetDeadline,
  onTurnTimeout,
  startRoom,
  scheduleOnlyMove,
  selectPlayerColor,
  removePlayer,
  voteToKick,
  recordPlayerAction,
} from "./game-store";
import {
  applyRoll,
  applyMove,
  getLegalMoves,
  secureDice,
  makeRoomCode,
  COLORS,
  type LudoColor,
} from "../lib/ludo-engine";

const PORT = parseInt(
  process.env.SOCKET_PORT || process.env.PORT || "4001",
  10,
);
const HOST = process.env.HOST || "0.0.0.0";
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const app = express();
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));
const http = createServer(app);
const io = new Server(http, {
  cors: { origin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN },
});

function roomInfo(roomId: string) {
  const room = rooms.get(roomId)!;
  return {
    roomId,
    size: room.size,
    started: room.started,
    players: room.game.players.map(({ name, color }) => ({ name, color })),
  };
}

function broadcast(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(`lobby:${roomId}`).emit("room-info", roomInfo(roomId));
  for (const removal of room.removals.splice(0)) {
    io.to(roomId).emit("table-notice", {
      message: `${removal.name}: ${removal.reason}`,
    });
    for (const client of io.sockets.sockets.values()) {
      if (
        removal.socketIds.includes(client.id) ||
        (client.data.gameRoom === roomId &&
          removal.playerIds.includes(client.data.playerId))
      ) {
        client.emit("table-removed", { reason: removal.reason });
        client.disconnect(true);
      }
    }
  }
  if (!room.game.players.length) {
    rooms.delete(roomId);
    return;
  }
  if (room.kickVote && room.kickVote.expiresAt <= Date.now())
    room.kickVote = undefined;
  for (const [socketId, playerIdx] of room.socketToPlayer) {
    io.to(socketId).emit("room-state", {
      ...room.game,
      playerIdx,
      turnDeadline: room.turnDeadline,
      size: room.size,
      started: room.started,
      connectedPlayers: [...new Set(room.socketToPlayer.values())],
      kickVote: room.kickVote
        ? {
            ...room.kickVote,
            needed: Math.max(
              2,
              Math.floor((room.game.players.length - 1) / 2) + 1,
            ),
          }
        : null,
    });
  }
}

function armTimer(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  scheduleOnlyMove(room, (result, playerIdx, tokenIdx) => {
    io.to(roomId).emit("token-moved", {
      player: result.state.players[playerIdx].color,
      tokenIdx,
      captured: result.captured,
      extraTurn: result.extraTurn,
      automatic: true,
    });
    armTimer(roomId);
    broadcast(roomId);
  });
  if (!room.started || room.game.stage === "game-over") {
    if (room.timer) clearTimeout(room.timer);
    return;
  }
  resetDeadline(room, () => {
    const changed = onTurnTimeout(room);
    if (room.game.stage !== "game-over") armTimer(roomId);
    if (changed) broadcast(roomId);
  });
}

io.on("connection", (socket) => {
  let joinedRoom: string | null = null;

  socket.on(
    "create-room",
    ({
      name,
      players,
      color,
    }: {
      name: string;
      players: number;
      color?: LudoColor;
    }) => {
      if (joinedRoom) return;
      if (color !== undefined && !COLORS.includes(color)) {
        socket.emit("error", {
          code: "BAD_COLOR",
          message: "Choose a valid color.",
        });
        return;
      }
      let roomId = makeRoomCode();
      while (rooms.has(roomId)) roomId = makeRoomCode();
      const size = [2, 3, 4].includes(players) ? players : 4;
      const playerId = nanoid(10);
      const room = getOrCreateRoom(roomId, size);
      addPlayer(room, String(name).slice(0, 16) || "Host", playerId, color);
      room.socketToPlayer.set(socket.id, 0);
      socket.join(roomId);
      joinedRoom = roomId;
      socket.emit("room-created", { roomId, playerId, playerIdx: 0 });
      broadcast(roomId);
    },
  );

  socket.on(
    "join-room",
    ({
      roomId,
      name,
      playerId,
      color,
    }: {
      roomId: string;
      name: string;
      playerId?: string;
      color?: LudoColor;
    }) => {
      try {
        const id = (roomId || "").toUpperCase();
        if (joinedRoom) return;
        const room = rooms.get(id);
        if (!room)
          return socket.emit("error", {
            code: "NO_ROOM",
            message: "Room not found",
          });
        const pid = playerId || nanoid(10);
        const idx = addPlayer(
          room,
          String(name).slice(0, 16) || "Guest",
          pid,
          color,
        );
        room.socketToPlayer.set(socket.id, idx);
        socket.join(id);
        joinedRoom = id;
        socket.emit("room-created", {
          roomId: id,
          playerId: pid,
          playerIdx: idx,
        });
        broadcast(id);
      } catch (e) {
        socket.emit("error", {
          code: "JOIN_FAILED",
          message: (e as Error).message,
        });
      }
    },
  );

  socket.on("leave-table", ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId);
    const index = room?.socketToPlayer.get(socket.id);
    if (!room || index === undefined) return;
    const current = room.game.turnIdx;
    removePlayer(room, index, "Left the table.");
    // Only reset another player's deadline if their turn was removed.
    if (index === current || room.game.stage === "game-over") armTimer(roomId);
    else
      scheduleOnlyMove(room, () => {
        armTimer(roomId);
        broadcast(roomId);
      });
    broadcast(roomId);
  });
  socket.on(
    "vote-kick",
    ({ roomId, target }: { roomId: string; target: number }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      try {
        const current = room.game.turnIdx;
        const removed = voteToKick(room, socket.id, target);
        if (removed) {
          if (target === current || room.game.stage === "game-over")
            armTimer(roomId);
          else
            scheduleOnlyMove(room, () => {
              armTimer(roomId);
              broadcast(roomId);
            });
        }
        broadcast(roomId);
      } catch (e) {
        socket.emit("error", {
          code: "VOTE_FAILED",
          message: (e as Error).message,
        });
      }
    },
  );

  socket.on("watch-room", ({ roomId }: { roomId: string }) => {
    const id = String(roomId || "").toUpperCase();
    if (!rooms.has(id)) {
      socket.emit("error", { code: "NO_ROOM", message: "Room not found" });
      return;
    }
    socket.join(`lobby:${id}`);
    socket.emit("room-info", roomInfo(id));
  });
  socket.on(
    "select-color",
    ({ roomId, color }: { roomId: string; color: LudoColor }) => {
      const room = rooms.get(roomId);
      if (!room) return;
      try {
        selectPlayerColor(room, socket.id, color);
        broadcast(roomId);
      } catch (e) {
        socket.emit("error", {
          code: "COLOR_UNAVAILABLE",
          message: (e as Error).message,
        });
      }
    },
  );

  socket.on("start-game", ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    try {
      startRoom(room, socket.id);
      armTimer(roomId);
      broadcast(roomId);
    } catch (e) {
      socket.emit("error", {
        code: "START_FAILED",
        message: (e as Error).message,
      });
    }
  });

  socket.on("roll-dice", ({ roomId }: { roomId: string }) => {
    const room = rooms.get(roomId);
    if (
      !room ||
      !room.started ||
      room.game.players.length < room.size ||
      !rateLimit(room, socket.id)
    )
      return;
    const pi = room.socketToPlayer.get(socket.id);
    if (
      pi === undefined ||
      room.game.turnIdx !== pi ||
      room.game.stage !== "await-roll"
    )
      return;
    try {
      const dice = secureDice();
      const { state, forfeited } = applyRoll(room.game, pi, dice);
      room.game = state;
      recordPlayerAction(room, pi);
      const moves =
        state.stage === "await-move" ? getLegalMoves(state, pi, dice) : [];
      io.to(roomId).emit("dice-rolled", {
        player: state.players[pi]?.color,
        value: dice,
        moves,
        forfeited,
      });
      armTimer(roomId);
      broadcast(roomId);
    } catch (e) {
      socket.emit("error", {
        code: "ROLL_FAILED",
        message: (e as Error).message,
      });
    }
  });

  socket.on(
    "move-token",
    ({ roomId, tokenIdx }: { roomId: string; tokenIdx: number }) => {
      const room = rooms.get(roomId);
      if (
        !room ||
        !room.started ||
        room.game.players.length < room.size ||
        !rateLimit(room, socket.id)
      )
        return;
      const pi = room.socketToPlayer.get(socket.id);
      if (
        pi === undefined ||
        room.game.turnIdx !== pi ||
        room.game.stage !== "await-move"
      )
        return;
      try {
        const dice = room.game.dice!;
        const { state, captured, extraTurn } = applyMove(
          room.game,
          pi,
          tokenIdx,
          dice,
        );
        room.game = state;
        recordPlayerAction(room, pi);
        io.to(roomId).emit("token-moved", {
          player: state.players[pi]?.color,
          tokenIdx,
          captured,
          extraTurn,
        });
        armTimer(roomId);
        broadcast(roomId);
      } catch (e) {
        socket.emit("error", {
          code: "MOVE_FAILED",
          message: (e as Error).message,
        });
      }
    },
  );

  socket.on("disconnect", () => {
    // Keep the player identity for reconnection; remove the stale socket.
    if (joinedRoom) {
      rooms.get(joinedRoom)?.socketToPlayer.delete(socket.id);
      rooms.get(joinedRoom)?.lastAction.delete(socket.id);
      broadcast(joinedRoom);
    }
    if (socket.data.voiceRoom)
      socket.to(socket.data.voiceRoom).emit("voice-signal", {
        roomId: socket.data.gameRoom,
        from: socket.data.peerId,
        type: "leave",
      });
  });

  // Authenticate the separate voice socket with the player's private room identity.
  socket.on(
    "voice-join",
    (
      msg: { roomId: string; playerId: string; peerId: string },
      ack?: (result: { ok: boolean }) => void,
    ) => {
      const id = String(msg?.roomId || "").toUpperCase();
      const room = rooms.get(id);
      if (!room?.playerIdToIdx.has(msg?.playerId) || !msg?.peerId) {
        ack?.({ ok: false });
        return;
      }
      const voiceRoom = `voice:${id}`;
      socket.join(voiceRoom);
      socket.data.voiceRoom = voiceRoom;
      socket.data.gameRoom = id;
      socket.data.peerId = msg.peerId;
      socket.data.playerId = msg.playerId;
      ack?.({ ok: true });
    },
  );
  socket.on(
    "voice-signal",
    (msg: {
      roomId: string;
      from: string;
      to?: string;
      type: string;
      payload?: unknown;
    }) => {
      if (
        !socket.data.voiceRoom ||
        msg?.roomId !== socket.data.gameRoom ||
        msg?.from !== socket.data.peerId
      )
        return;
      if (
        !["join", "join-ack", "offer", "answer", "ice", "leave"].includes(
          msg.type,
        )
      )
        return;
      socket.to(socket.data.voiceRoom).emit("voice-signal", msg);
    },
  );
});

http.listen(PORT, HOST, () =>
  console.log(
    `[socket] listening on ${HOST}:${PORT} cors=${CORS_ORIGIN.join(",")}`,
  ),
);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[socket] ${sig} — closing`);
    io.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
