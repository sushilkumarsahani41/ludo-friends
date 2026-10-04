"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import Board from "@/components/Board";
import ColorPicker from "@/components/ColorPicker";
import Icon from "@/components/Icon";
import { DiceFace } from "@/components/Dice";
import {
  COLORS,
  createGame,
  makeRoomCode,
  type LudoColor,
} from "@/lib/ludo-engine";
import { SOCKET_URL } from "@/lib/socket-protocol";

const preview = createGame(
  "PREVIEW",
  COLORS.map((color, i) => ({
    color,
    name: ["You", "Your bestie", "The lucky one", "The rival"][i],
  })),
);
preview.players[0].tokens = [-1, -1, 7, 16];
preview.players[1].tokens = [-1, -1, -1, 5];
preview.players[2].tokens = [-1, -1, 10, 22];
preview.players[3].tokens = [-1, -1, -1, 12];

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [players, setPlayers] = useState(4);
  const [color, setColor] = useState<LudoColor>("red");
  const [tab, setTab] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      socketRef.current?.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function enter(local = false) {
    if (busy) return;
    if (name.trim().length < 2) {
      setError("Add your name first — at least 2 characters.");
      return;
    }
    localStorage.setItem("ludo-name", name.trim());
    setError("");
    if (local) {
      const id = makeRoomCode();
      localStorage.setItem(`ludo-room-${id}-players`, String(players));
      localStorage.setItem(`ludo-room-${id}-color`, color);
      router.push(`/room/${id}?mode=local`);
      return;
    }
    if (tab === "join") {
      if (!/^[A-Z0-9_-]{6}$/.test(code)) {
        setError("Enter the 6-character room code from your friend.");
        return;
      }
      router.push(`/room/${code}`);
      return;
    }
    setBusy(true);
    const socket = io(SOCKET_URL, { timeout: 7000, reconnection: false });
    socketRef.current = socket;
    const fail = () => {
      socket.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
      setBusy(false);
      setError(
        "We couldn’t reach the game server. Try again, or play together on this device.",
      );
    };
    socket.once("connect", () =>
      socket.emit("create-room", { name: name.trim(), players, color }),
    );
    socket.once(
      "room-created",
      ({ roomId, playerId }: { roomId: string; playerId: string }) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        localStorage.setItem(`ludo-pid-${roomId}`, playerId);
        socket.disconnect();
        router.push(`/room/${roomId}`);
      },
    );
    socket.once("connect_error", fail);
    socket.once("error", fail);
    timerRef.current = setTimeout(fail, 10000);
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Icon name="dice" size={25} />
          </span>
          ludo<span className="brand-light">friends</span>
          <span className="brand-dot">.</span>
        </Link>
        <a href="#how-to-play" className="header-link">
          New to the game?{" "}
          <span>
            How to play <Icon name="arrow" size={15} />
          </span>
        </a>
      </header>
      <main>
        <div className="landing-grid">
          <section className="welcome-panel">
            <span className="eyebrow">
              <span className="status-dot" /> GOOD TIMES, ONE ROLL AWAY
            </span>
            <h1>
              Old-school game.
              <br />
              <span>Whole new</span>
              <br />
              game night.
            </h1>
            <p className="hero-description">
              A little luck. A little rivalry. A lot of “one more game.”
              <br className="desktop-break" /> Bring your favorite people. We’ll
              bring the board.
            </p>
            <div className="lobby-card">
              <div
                className="lobby-tabs"
                role="tablist"
                aria-label="Room options"
              >
                <button
                  role="tab"
                  aria-selected={tab === "create"}
                  aria-controls="room-form"
                  id="create-tab"
                  onClick={() => {
                    setTab("create");
                    setError("");
                  }}
                  disabled={busy}
                  className={tab === "create" ? "selected" : ""}
                >
                  <Icon name="dice" size={18} />
                  Create a room
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "join"}
                  aria-controls="room-form"
                  id="join-tab"
                  onClick={() => {
                    setTab("join");
                    setError("");
                  }}
                  disabled={busy}
                  className={tab === "join" ? "selected" : ""}
                >
                  <Icon name="link" size={18} />
                  Join friends
                </button>
              </div>
              <form
                id="room-form"
                role="tabpanel"
                aria-labelledby={`${tab}-tab`}
                onSubmit={(e) => {
                  e.preventDefault();
                  enter();
                }}
              >
                <label htmlFor="player-name">What should we call you?</label>
                <div className="input-wrap">
                  <Icon name="people" size={19} />
                  <input
                    id="player-name"
                    placeholder="Your game-night name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={16}
                    minLength={2}
                    required
                    autoComplete="nickname"
                    disabled={busy}
                  />
                  <span>{name.length}/16</span>
                </div>
                {tab === "create" ? (
                  <fieldset className="player-selector">
                    <legend>
                      Seats at the table <span>You’re included</span>
                    </legend>
                    <div>
                      {[2, 3, 4].map((n) => (
                        <button
                          type="button"
                          key={n}
                          aria-pressed={players === n}
                          onClick={() => setPlayers(n)}
                          disabled={busy}
                          className={players === n ? "selected" : ""}
                        >
                          <Icon name="people" size={18} />
                          {n} players
                          {players === n && <Icon name="check" size={15} />}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                ) : (
                  <div className="join-field">
                    <label htmlFor="room-code">Your room code</label>
                    <input
                      id="room-code"
                      className="code-input"
                      placeholder="ABC123"
                      value={code}
                      onChange={(e) =>
                        setCode(
                          e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9_-]/g, ""),
                        )
                      }
                      maxLength={6}
                      minLength={6}
                      required
                      autoComplete="off"
                    />
                  </div>
                )}
                {tab === "create" && (
                  <ColorPicker
                    value={color}
                    onChange={setColor}
                    disabled={busy}
                    opposite={players === 2}
                  />
                )}
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="button button-primary"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? (
                    <>
                      <span className="spinner" />
                      Setting your table…
                    </>
                  ) : (
                    <>
                      {tab === "create" ? "Let’s play" : "Join the table"}
                      <Icon name="arrow" />
                    </>
                  )}
                </button>
                {tab === "create" && (
                  <button
                    type="button"
                    className="local-button"
                    onClick={() => enter(true)}
                    disabled={busy}
                  >
                    All in the same room?{" "}
                    <span>
                      Pass & play <Icon name="arrow" size={14} />
                    </span>
                  </button>
                )}
                <p className="form-note">
                  No accounts. No downloads. Just good company.
                </p>
              </form>
            </div>
          </section>
          <section
            className="hero-art"
            aria-label="A classic four-color Ludo board"
          >
            <div className="art-orbit orbit-one" />
            <div className="art-orbit orbit-two" />
            <span className="art-spark spark-one">✳</span>
            <span className="art-spark spark-two">✧</span>
            <div className="floating-note note-top">
              <span className="avatar avatar-green">R</span>
              <span>
                Riya joined the fun <span className="wave">✌</span>
                <small>Your people. Your table.</small>
              </span>
            </div>
            <div className="hero-board">
              <Board game={preview} preview />
            </div>
            <div className="floating-dice">
              <DiceFace value={5} />
            </div>
            <div className="floating-note note-bottom">
              <span className="voice-illustration">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <div>
                Let the friendly trash talk begin.
                <small>Voice chat, right at the table.</small>
              </div>
            </div>
            <p className="art-caption">
              SAME CLASSIC GAME. CLOSER CONNECTIONS.
            </p>
          </section>
        </div>
        <section
          className="feature-strip"
          id="how-to-play"
          aria-label="How to play"
        >
          <div>
            <span className="feature-icon">
              <Icon name="link" size={23} />
            </span>
            <div>
              <h2>Send a little invite</h2>
              <p>Create a room. Share the link. Bring 2–4 friends.</p>
            </div>
          </div>
          <div>
            <span className="feature-icon">
              <Icon name="dice" size={23} />
            </span>
            <div>
              <h2>Race your way home</h2>
              <p>Roll a six to start. Get all four tokens home to win.</p>
            </div>
          </div>
          <div>
            <span className="feature-icon">
              <Icon name="mic" size={23} />
            </span>
            <div>
              <h2>Make some noise</h2>
              <p>Join voice chat. Celebrate every lucky roll.</p>
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <span>A classic, best played together.</span>
        <span>
          Made for friends{" "}
          <span className="tiny-colors">
            <i />
            <i />
            <i />
            <i />
          </span>
        </span>
      </footer>
    </div>
  );
}
