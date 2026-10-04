"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { nanoid } from "nanoid";
import { SOCKET_URL } from "@/lib/socket-protocol";

export type VoiceStatus = "off" | "joining" | "on" | "blocked" | "error";

export interface VoicePeer {
  peerId: string;
  name: string;
  talking: boolean;
}

interface SignalMsg {
  roomId: string;
  from: string;
  to?: string;
  type: "join" | "join-ack" | "offer" | "answer" | "ice" | "leave";
  payload?: unknown;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ],
};

/**
 * P2P mesh voice: signaling over our socket.io server, audio direct
 * browser-to-browser (free STUN, no media server, no keys).
 * Highest peerId always initiates the offer — glare-free.
 */
export function useVoiceMesh(roomId: string, name: string) {
  const [status, setStatus] = useState<VoiceStatus>("off");
  const [muted, setMuted] = useState(false);
  const [peers, setPeers] = useState<VoicePeer[]>([]);
  const sockRef = useRef<Socket | null>(null);
  const pcsRef = useRef(new Map<string, RTCPeerConnection>());
  const namesRef = useRef(new Map<string, string>());
  const audioElsRef = useRef(new Map<string, HTMLAudioElement>());
  const analysersRef = useRef(
    new Map<
      string,
      { ctx: AudioContext; an: AnalyserNode; buf: Uint8Array<ArrayBuffer> }
    >(),
  );
  const streamRef = useRef<MediaStream | null>(null);
  const idRef = useRef(nanoid(8));
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mutedRef = useRef(false);
  const myId = idRef.current;

  const setTalking = useCallback((peerId: string, talking: boolean) => {
    setPeers((prev) =>
      prev.map((p) =>
        p.peerId === peerId && p.talking !== talking ? { ...p, talking } : p,
      ),
    );
  }, []);

  const removePeer = useCallback((peerId: string) => {
    pcsRef.current.get(peerId)?.close();
    pcsRef.current.delete(peerId);
    namesRef.current.delete(peerId);
    const an = analysersRef.current.get(peerId);
    try {
      an?.ctx.close();
    } catch {
      /* noop */
    }
    analysersRef.current.delete(peerId);
    const el = audioElsRef.current.get(peerId);
    el?.remove();
    audioElsRef.current.delete(peerId);
    setPeers((prev) => prev.filter((p) => p.peerId !== peerId));
  }, []);

  const teardown = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    try {
      sockRef.current?.emit("voice-signal", {
        roomId,
        from: myId,
        type: "leave",
      });
    } catch {
      /* noop */
    }
    for (const pid of [...pcsRef.current.keys()]) {
      pcsRef.current.get(pid)?.close();
    }
    pcsRef.current.clear();
    namesRef.current.clear();
    for (const [, a] of analysersRef.current) {
      try {
        a.ctx.close();
      } catch {
        /* noop */
      }
    }
    analysersRef.current.clear();
    for (const [, el] of audioElsRef.current) el.remove();
    audioElsRef.current.clear();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    sockRef.current?.removeAllListeners();
    sockRef.current?.disconnect();
    sockRef.current = null;
    setPeers([]);
  }, [roomId, myId]);

  const attachRemote = useCallback((peerId: string, stream: MediaStream) => {
    let el = audioElsRef.current.get(peerId);
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      document.body.appendChild(el);
      audioElsRef.current.set(peerId, el);
    }
    el.srcObject = stream;
    el.play().catch(() => {
      /* autoplay may need gesture; user clicked Join */
    });
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      analysersRef.current.set(peerId, {
        ctx,
        an,
        buf: new Uint8Array(new ArrayBuffer(an.frequencyBinCount)),
      });
    } catch {
      /* talking indicator optional */
    }
  }, []);

  const ensurePC = useCallback(
    async (peerId: string): Promise<RTCPeerConnection> => {
      const existing = pcsRef.current.get(peerId);
      if (existing) return existing;
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcsRef.current.set(peerId, pc);
      streamRef.current
        ?.getTracks()
        .forEach((t) => pc.addTrack(t, streamRef.current!));
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sockRef.current?.emit("voice-signal", {
            roomId,
            from: myId,
            to: peerId,
            type: "ice",
            payload: e.candidate.toJSON(),
          });
        }
      };
      pc.ontrack = (e) => {
        if (e.streams[0]) attachRemote(peerId, e.streams[0]);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed")
          removePeer(peerId);
      };
      return pc;
    },
    [attachRemote, myId, removePeer, roomId],
  );

  const handleSignal = useCallback(
    async (msg: SignalMsg) => {
      if (msg.from === myId) return;
      if (msg.to && msg.to !== myId) return;
      const peerId = msg.from;
      try {
        if (msg.type === "join" || msg.type === "join-ack") {
          const peerName =
            (msg.payload as { name?: string } | undefined)?.name || "Guest";
          namesRef.current.set(peerId, peerName.slice(0, 16));
          setPeers((prev) =>
            prev.some((p) => p.peerId === peerId)
              ? prev
              : [
                  ...prev,
                  { peerId, name: peerName.slice(0, 16), talking: false },
                ],
          );
          if (msg.type === "join") {
            sockRef.current?.emit("voice-signal", {
              roomId,
              from: myId,
              to: peerId,
              type: "join-ack",
              payload: { name },
            });
          }
          // Highest id offers — both sides apply the same rule, no glare.
          if (myId > peerId) {
            const pc = await ensurePC(peerId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sockRef.current?.emit("voice-signal", {
              roomId,
              from: myId,
              to: peerId,
              type: "offer",
              payload: offer,
            });
          }
        } else if (msg.type === "offer") {
          const pc = await ensurePC(peerId);
          await pc.setRemoteDescription(
            msg.payload as RTCSessionDescriptionInit,
          );
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sockRef.current?.emit("voice-signal", {
            roomId,
            from: myId,
            to: peerId,
            type: "answer",
            payload: answer,
          });
        } else if (msg.type === "answer") {
          const pc = pcsRef.current.get(peerId);
          if (pc && pc.signalingState !== "stable") {
            await pc.setRemoteDescription(
              msg.payload as RTCSessionDescriptionInit,
            );
          }
        } else if (msg.type === "ice") {
          const pc = pcsRef.current.get(peerId);
          if (pc && msg.payload) {
            await pc
              .addIceCandidate(msg.payload as RTCIceCandidateInit)
              .catch(() => {});
          }
        } else if (msg.type === "leave") {
          removePeer(peerId);
        }
      } catch {
        // one bad peer must not kill the mesh
      }
    },
    [ensurePC, myId, name, removePeer, roomId],
  );

  async function join() {
    if (status === "joining" || status === "on") return;
    setStatus("joining");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-mic-api");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getAudioTracks().forEach((t) => {
        t.enabled = !mutedRef.current;
      });
      streamRef.current = stream;
      const s = io(SOCKET_URL, { timeout: 8000, reconnectionAttempts: 5 });
      sockRef.current = s;
      s.on("connect", () => {
        s.timeout(6000).emit(
          "voice-join",
          {
            roomId,
            playerId: localStorage.getItem(`ludo-pid-${roomId}`),
            peerId: myId,
          },
          (err: Error | null, result: { ok: boolean } | undefined) => {
            if (err || !result?.ok) {
              teardown();
              setStatus("error");
              return;
            }
            setStatus("on");
            s.emit("voice-signal", {
              roomId,
              from: myId,
              type: "join",
              payload: { name },
            });
          },
        );
      });
      s.on("connect_error", () => {
        teardown();
        setStatus("error");
      });
      s.on("disconnect", () => {
        teardown();
        setStatus("error");
      });
      s.on("voice-signal", (msg: SignalMsg) => {
        void handleSignal(msg);
      });
      // talking-indicator poll
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        for (const [pid, a] of analysersRef.current) {
          a.an.getByteTimeDomainData(a.buf);
          let sum = 0;
          for (let i = 0; i < a.buf.length; i++) {
            const v = (a.buf[i] - 128) / 128;
            sum += v * v;
          }
          const talking = Math.sqrt(sum / a.buf.length) > 0.04;
          setTalking(pid, talking);
        }
      }, 250);
    } catch (e) {
      teardown();
      const msg = (e as Error).message || "";
      setStatus(
        /denied|NotAllowed|Permission/i.test(msg) ? "blocked" : "error",
      );
    }
  }

  function leave() {
    teardown();
    setStatus("off");
  }

  function toggleMute() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    streamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
  }

  useEffect(() => () => teardown(), [teardown]);

  return { status, muted, peers, join, leave, toggleMute };
}
