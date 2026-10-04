"use client";
import {
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import Board, { PLAYER_COLORS } from "@/components/Board";
import Dice from "@/components/Dice";
import ColorPicker from "@/components/ColorPicker";
import { availableColors } from "@/lib/room-colors";
import Icon from "@/components/Icon";
import VoiceBar from "@/components/VoiceBar";
import { useGameAudio } from "@/hooks/useGameAudio";
import { useAnimatedGame } from "@/hooks/useAnimatedGame";
import { useGameSocket } from "@/hooks/useGameSocket";
import {
  createGame,
  applyRoll,
  applyMove,
  getLegalMoves,
  getOnlyLegalMove,
  secureDice,
  colorsForPlayers,
  COLORS,
  FINISHED,
  type LudoColor,
} from "@/lib/ludo-engine";
import { AUTO_MOVE_PAUSE_MS } from "@/lib/game-feedback";

const subscribe = () => () => {};
export default function RoomPage() {
  return (
    <Suspense
      fallback={<div className="loading-screen">Setting the table…</div>}
    >
      <RoomRoute />
    </Suspense>
  );
}
function RoomRoute() {
  const localMode = useSearchParams().get("mode") === "local";
  const { id } = useParams<{ id: string }>();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return hydrated ? (
    <Room
      key={`${id}-${localMode}`}
      roomId={id.toUpperCase()}
      localMode={localMode}
    />
  ) : (
    <div className="loading-screen">
      <span className="spinner" />
      Setting the table…
    </div>
  );
}
function Room({ roomId, localMode }: { roomId: string; localMode: boolean }) {
  const [name, setName] = useState(
    () => localStorage.getItem("ludo-name") || "",
  );
  const [draftName, setDraftName] = useState(name);
  const [joinRequested, setJoinRequested] = useState(
    () => localMode || !!localStorage.getItem(`ludo-pid-${roomId}`),
  );
  const [draftColor, setDraftColor] = useState<LudoColor>();
  const [joinColor, setJoinColor] = useState<LudoColor>();
  const [local, setLocal] = useState(() => {
    const n = Number(localStorage.getItem(`ludo-room-${roomId}-players`)) || 4;
    return createGame(
      roomId,
      colorsForPlayers(
        [2, 3, 4].includes(n) ? n : 4,
        COLORS.find(
          (c) => c === localStorage.getItem(`ludo-room-${roomId}-color`),
        ) ?? "red",
      ).map((color, i) => ({
        color,
        name: i === 0 ? name || "You" : `Player ${i + 1}`,
      })),
    );
  });
  const [localStarted, setLocalStarted] = useState(false);
  const [log, setLog] = useState<string[]>([
    "Your table is ready. Let’s play!",
  ]);
  const [copyState, setCopyState] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [rules, setRules] = useState(false);
  const audio = useGameAudio();
  const online = useGameSocket(
    roomId,
    name,
    !localMode,
    joinRequested,
    joinColor,
  );
  const joinAvailable =
    online.preview &&
    !online.preview.started &&
    online.preview.players.length < online.preview.size
      ? availableColors(online.preview.size, online.preview.players)
      : [];
  const selectedJoinColor =
    draftColor && joinAvailable.includes(draftColor)
      ? draftColor
      : joinAvailable[0];
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  const authoritativeGame = localMode ? local : online.game;
  const animation = useAnimatedGame(authoritativeGame, audio.play);
  useEffect(() => {
    if (!localMode || !localStarted || animation.animating) return;
    const tokenIdx = getOnlyLegalMove(local);
    if (tokenIdx === null) return;
    const timer = setTimeout(() => {
      const result = applyMove(local, local.turnIdx, tokenIdx, local.dice!);
      setLocal(result.state);
      setLog((prev) =>
        [
          `${local.players[local.turnIdx].name} automatically moves token ${tokenIdx + 1}${result.captured.length ? " · captured a token!" : ""}${result.extraTurn ? " · roll again" : ""}`,
          ...prev,
        ].slice(0, 20),
      );
    }, AUTO_MOVE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [localMode, localStarted, local, animation.animating]);
  const game = animation.game;
  const waiting = localMode ? !localStarted : !online.game?.started;
  const isHost = localMode || online.myIdx === 0;
  const connectedSeats = online.game?.connectedPlayers ?? [];
  const readyToStart =
    localMode ||
    (!!online.game &&
      online.connected &&
      online.game.players.length === online.game.size &&
      connectedSeats.length === online.game.size);
  const me = game?.players[game.turnIdx];
  const myTurn = localMode || online.myIdx === game?.turnIdx;
  const canAct = (localMode || online.connected) && !animation.animating;
  const legal =
    game &&
    !waiting &&
    canAct &&
    myTurn &&
    game.stage === "await-move" &&
    game.dice != null
      ? getLegalMoves(game, game.turnIdx, game.dice)
      : [];
  const automaticToken = game && !waiting ? getOnlyLegalMove(game) : null;
  const seconds = online.game?.turnDeadline
    ? Math.min(
        30,
        Math.max(0, Math.ceil((online.game.turnDeadline - now) / 1000)),
      )
    : 30;
  function add(message: string) {
    setLog((prev) => [message, ...prev].slice(0, 20));
  }
  function roll() {
    if (!game || waiting || !canAct || !myTurn || game.stage !== "await-roll")
      return;
    if (!localMode) {
      online.roll();
      return;
    }
    const value = secureDice();
    const result = applyRoll(game, game.turnIdx, value);
    setLocal(result.state);
    add(
      `${me?.name} rolled ${value}${result.forfeited ? " · three sixes, turn passed" : result.state.turnIdx !== game.turnIdx ? " · no moves, turn passed" : ""}`,
    );
  }

  function move(index: number) {
    if (!game || automaticToken !== null || !legal.includes(index)) return;
    if (!localMode) {
      online.move(index);
      return;
    }
    const result = applyMove(game, game.turnIdx, index, game.dice!);
    setLocal(result.state);
    add(
      `${me?.name} moved token ${index + 1}${result.captured.length ? " · captured a token!" : ""}${result.extraTurn ? " · roll again" : ""}`,
    );
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/room/${roomId}`,
      );
      setCopyState("Invite copied!");
    } catch {
      setCopyState(`Share this code: ${roomId}`);
    }
  }
  const winner = game?.players.find((p) => p.color === game.winner);
  return (
    <div className="site-shell room-shell">
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Icon name="dice" size={25} />
          </span>
          ludo<span className="brand-light">friends</span>
          <span className="brand-dot">.</span>
        </Link>
        <Link href="/" className="back-link">
          <Icon name="home" size={16} />
          Back to lobby
        </Link>
      </header>
      <main>
        <div className="room-heading">
          <div>
            <span className="eyebrow">
              {localMode
                ? "ONE DEVICE. ALL YOUR FRIENDS."
                : "YOUR PEOPLE. YOUR TABLE."}
            </span>
            <h1>
              {localMode ? "Pass, play & repeat." : "Let the good times roll."}
            </h1>
          </div>
          <div className="room-tools">
            <button
              className="sound-toggle"
              type="button"
              onClick={audio.toggle}
              aria-pressed={audio.muted}
              aria-label={
                audio.muted ? "Unmute game sounds" : "Mute game sounds"
              }
              title="Game sound effects (separate from voice chat)"
            >
              <Icon name={audio.muted ? "volume-off" : "volume"} size={17} />
              <span>{audio.muted ? "Sound off" : "Sound on"}</span>
            </button>
            <div
              className={`connection-badge ${!localMode && !online.connected ? "connecting" : ""}`}
            >
              <span className="status-dot" />
              {localMode
                ? "Pass & play"
                : online.connected
                  ? "Connected"
                  : "Connecting…"}
            </div>
          </div>
        </div>
        {!joinRequested && !localMode ? (
          <section className="empty-room join-room-card">
            <span className="large-icon">
              <Icon name="people" size={30} />
            </span>
            <h2>You’re invited.</h2>
            <p>Pick your name and color for table {roomId}.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (
                  draftName.trim().length >= 2 &&
                  selectedJoinColor &&
                  online.connected
                ) {
                  localStorage.setItem("ludo-name", draftName.trim());
                  setName(draftName.trim());
                  setJoinColor(selectedJoinColor);
                  setJoinRequested(true);
                }
              }}
            >
              <label className="sr-only" htmlFor="guest-name">
                Your name
              </label>
              <input
                id="guest-name"
                autoFocus
                minLength={2}
                maxLength={16}
                required
                placeholder="Your game-night name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
              />
              <ColorPicker
                value={selectedJoinColor}
                onChange={setDraftColor}
                available={joinAvailable}
                occupied={online.preview?.players}
                disabled={!online.connected}
                opposite={online.preview?.size === 2}
              />
              {online.preview?.size === 2 && (
                <small className="lobby-hint">
                  The host chooses the pair. You’ll play the opposite color.
                </small>
              )}
              {online.error && (
                <p className="form-error" role="alert">
                  {online.error}
                </p>
              )}
              {online.preview?.started ? (
                <p role="status">This game has already started.</p>
              ) : online.preview &&
                online.preview.players.length >= online.preview.size ? (
                <p role="status">This table is full.</p>
              ) : !online.preview && !online.error ? (
                <p role="status">Checking available colors…</p>
              ) : null}
              <button
                className="button button-primary"
                disabled={!selectedJoinColor || !online.connected}
              >
                Join friends
                <Icon name="arrow" />
              </button>
            </form>
          </section>
        ) : !game ? (
          <section className="empty-room">
            <span className="large-icon">
              <Icon name="dice" size={30} />
            </span>
            <h2>
              {online.error
                ? "Couldn’t join this table."
                : "Pulling up a chair…"}
            </h2>
            <p role={online.error ? "alert" : "status"}>
              {online.error || "Connecting you to your friends."}
            </p>
            {online.error && (
              <div className="empty-actions">
                <button
                  className="button button-primary"
                  onClick={() => setJoinRequested(false)}
                >
                  Choose a color again
                </button>
                <Link href="/" className="button button-secondary">
                  Back to lobby
                </Link>
              </div>
            )}
          </section>
        ) : (
          <>
            {online.error && !localMode && (
              <div className="notice" role="alert">
                {online.error} Your game stays at this table.
              </div>
            )}
            <div
              className={`game-layout ${waiting ? "is-waiting" : "is-playing"}`}
            >
              <section className="game-table" aria-label="Game table">
                <div className="table-topline">
                  <span>
                    <Icon name={localMode ? "people" : "globe"} size={16} />
                    {localMode ? (
                      "The living room table"
                    ) : (
                      <>
                        TABLE <strong>{roomId}</strong>
                      </>
                    )}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => setRules(!rules)}
                    aria-expanded={rules}
                  >
                    {rules ? "Hide rules" : "How to play"}
                  </button>
                </div>
                {rules && (
                  <div className="rules-panel">
                    <strong>A quick refresher</strong>
                    <p>
                      Roll a 6 to leave your yard. Tap a highlighted token to
                      move. Landing on a rival sends them back, except on star
                      squares. A 6, capture, or token reaching home earns
                      another roll. Three sixes in a row pass the turn. Roll the
                      exact number to finish all four tokens.
                    </p>
                  </div>
                )}
                {waiting ? (
                  <section className="room-lobby" aria-label="Waiting lobby">
                    <span className="large-icon">
                      <Icon name="people" size={30} />
                    </span>
                    <span className="eyebrow">
                      {localMode ? "GET COMFORTABLE" : `ROOM ${roomId}`}
                    </span>
                    <h2>
                      {readyToStart
                        ? "Everyone’s here. Ready to roll?"
                        : "Save a seat for your friends."}
                    </h2>
                    <p>
                      {localMode
                        ? "Pass the device between turns. Start whenever you’re ready."
                        : isHost
                          ? "You’re the host. Once everyone has joined, you decide when the game begins."
                          : `Make yourself at home. ${game.players[0]?.name} will start the game once everyone is here.`}
                    </p>
                    <ColorPicker
                      value={
                        localMode
                          ? local.players[0].color
                          : online.myIdx !== null
                            ? online.game?.players[online.myIdx]?.color
                            : undefined
                      }
                      onChange={(color) => {
                        if (localMode) {
                          const palette = colorsForPlayers(
                            local.players.length,
                            color,
                          );
                          setLocal((prev) => ({
                            ...prev,
                            players: prev.players.map((p, i) => ({
                              ...p,
                              color: palette[i],
                            })),
                          }));
                          localStorage.setItem(
                            `ludo-room-${roomId}-color`,
                            color,
                          );
                        } else online.selectColor(color);
                      }}
                      available={
                        localMode
                          ? COLORS
                          : online.game && online.myIdx !== null
                            ? availableColors(
                                online.game.size ?? 4,
                                online.game.players,
                                online.myIdx,
                              )
                            : []
                      }
                      occupied={
                        localMode
                          ? []
                          : online.game?.players.filter(
                              (_, i) => i !== online.myIdx,
                            )
                      }
                      disabled={!localMode && !online.connected}
                      opposite={
                        (localMode
                          ? local.players.length
                          : online.game?.size) === 2
                      }
                    />
                    <div className="lobby-seats">
                      {Array.from(
                        {
                          length: localMode
                            ? game.players.length
                            : (online.game?.size ?? 4),
                        },
                        (_, i) => {
                          const player = game.players[i];
                          const present =
                            localMode || connectedSeats.includes(i);
                          return (
                            <div
                              className={`lobby-seat ${player && present ? "seat-ready" : ""}`}
                              key={i}
                              style={
                                {
                                  "--player-color": player
                                    ? PLAYER_COLORS[player.color]
                                    : "#9ba68e",
                                } as CSSProperties
                              }
                            >
                              <span className="player-avatar">
                                {player
                                  ? player.name.slice(0, 1).toUpperCase()
                                  : "+"}
                              </span>
                              <strong>{player?.name ?? "Open seat"}</strong>
                              <small>
                                {player
                                  ? !present
                                    ? "Reconnecting…"
                                    : i === 0
                                      ? "Host · ready"
                                      : "Ready"
                                  : "Waiting for a friend"}
                              </small>
                            </div>
                          );
                        },
                      )}
                    </div>
                    {isHost ? (
                      <button
                        className="button button-primary start-game-button"
                        disabled={!readyToStart}
                        onClick={() =>
                          localMode ? setLocalStarted(true) : online.start()
                        }
                      >
                        <Icon name="dice" size={19} />
                        Start game
                        <Icon name="arrow" size={18} />
                      </button>
                    ) : (
                      <div className="host-wait-message" role="status">
                        <Icon name="clock" size={18} />
                        Waiting for the host to start
                      </div>
                    )}
                    {!readyToStart && isHost && (
                      <small className="lobby-hint">
                        All {online.game?.size ?? 4} players need to be
                        connected to start.
                      </small>
                    )}
                    {!localMode && (
                      <button
                        className="button button-secondary"
                        onClick={copy}
                      >
                        <Icon name="copy" size={17} />
                        {copyState || "Copy invite link"}
                      </button>
                    )}
                    {game.players.length === 2 &&
                      (localMode || online.game?.size === 2) && (
                        <small className="lobby-hint">
                          Opposite seats: {game.players[0].color} vs{" "}
                          {game.players[1].color}.
                        </small>
                      )}
                  </section>
                ) : (
                  <>
                    <Board
                      game={game}
                      legalMoves={automaticToken === null ? legal : []}
                      onTokenClick={move}
                      movingToken={animation.movingToken}
                      returningTokens={animation.returningTokens}
                    />
                    <div
                      className="turn-panel"
                      style={
                        {
                          "--player-color": PLAYER_COLORS[me!.color],
                        } as CSSProperties
                      }
                    >
                      <Dice
                        value={game.dice ?? game.lastRoll?.value ?? null}
                        canRoll={
                          !waiting &&
                          myTurn &&
                          canAct &&
                          game.stage === "await-roll"
                        }
                        onRoll={roll}
                        rolling={animation.rolling}
                      />
                      <div className="turn-copy">
                        <span className="eyebrow">
                          {game.stage === "game-over"
                            ? "THAT’S A WRAP"
                            : waiting
                              ? "GOOD COMPANY TAKES A MOMENT"
                              : myTurn
                                ? "YOUR MOVE"
                                : "AT THE TABLE"}
                        </span>
                        <h2 aria-live="polite">
                          {game.stage === "game-over"
                            ? `${winner?.name} wins!`
                            : waiting
                              ? "Waiting for your friends…"
                              : animation.rolling
                                ? "A little luck coming up…"
                                : animation.returningTokens.length
                                  ? "Captured goti heading back…"
                                  : animation.animating
                                    ? "Moving one step at a time…"
                                    : game.stage === "await-move"
                                      ? automaticToken !== null
                                        ? "One possible move. We’ve got it."
                                        : myTurn
                                          ? "Pick a highlighted token"
                                          : `${me?.name} is choosing a token`
                                      : myTurn
                                        ? "Go on, give it a roll."
                                        : `${me?.name} is rolling next`}
                        </h2>
                        <p>
                          {waiting
                            ? `${game.players.length} of ${online.game?.size ?? 2} seats filled. Share your invite to begin.`
                            : game.stage === "game-over"
                              ? "Good game. Time for a rematch?"
                              : localMode
                                ? `Pass the device to ${me?.name}.`
                                : myTurn
                                  ? "Your next lucky roll is one tap away."
                                  : "Your turn is coming. Keep the conversation going."}
                        </p>
                      </div>
                      {!localMode && !waiting && game.stage !== "game-over" && (
                        <span
                          className={`turn-timer ${seconds <= 10 ? "urgent" : ""}`}
                          title="Seconds before automatic play"
                        >
                          <Icon name="clock" size={16} />
                          {seconds}s
                        </span>
                      )}
                    </div>
                    {automaticToken !== null && !animation.animating && (
                      <div className="auto-move-notice" role="status">
                        <Icon name="arrow" size={16} />
                        Auto move · token {automaticToken + 1} follows your
                        roll.
                      </div>
                    )}
                    {legal.length > 0 && automaticToken === null && (
                      <div className="move-options">
                        <span>Move a token</span>
                        {legal.map((i) => (
                          <button
                            key={i}
                            onClick={() => move(i)}
                            style={
                              {
                                "--player-color": PLAYER_COLORS[me!.color],
                              } as CSSProperties
                            }
                          >
                            Token {i + 1}
                            <Icon name="arrow" size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                    {game.stage === "game-over" && (
                      <Link
                        href="/"
                        className="button button-primary rematch-button"
                      >
                        Play another round
                        <Icon name="arrow" />
                      </Link>
                    )}
                  </>
                )}
                {!localMode && <VoiceBar roomId={roomId} name={name} />}
                {localMode && (
                  <div className="local-caption">
                    <Icon name="people" size={17} />
                    One screen, a little friendly rivalry, and everyone
                    together.
                  </div>
                )}
              </section>
              <aside className="game-sidebar">
                <section className="sidebar-card players-card">
                  <div className="card-heading">
                    <h2>Around the table</h2>
                    <span>
                      {game.players.length}/
                      {localMode
                        ? game.players.length
                        : (online.game?.size ?? 4)}
                    </span>
                  </div>
                  <div className="player-list">
                    {game.players.map((p, i) => (
                      <div
                        className={`player-row ${i === game.turnIdx && !waiting && game.stage !== "game-over" ? "current-player" : ""}`}
                        key={p.color}
                        style={
                          {
                            "--player-color": PLAYER_COLORS[p.color],
                          } as CSSProperties
                        }
                      >
                        <span className="player-avatar">
                          {p.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="player-info">
                          <strong>
                            {p.name}
                            {!localMode && i === online.myIdx && (
                              <small> (you)</small>
                            )}
                          </strong>
                          <span>
                            {p.finished
                              ? "All home. Well played!"
                              : i === game.turnIdx && !waiting
                                ? "Taking a turn"
                                : p.color}
                          </span>
                        </div>
                        <div
                          className="player-progress"
                          aria-label={`${p.tokens.filter((t) => t === FINISHED).length} of 4 tokens home`}
                        >
                          {p.tokens.map((t, index) => (
                            <i key={index} className={t === FINISHED ? "home" : ""} />
                          ))}
                        </div>
                      </div>
                    ))}
                    {!localMode &&
                      Array.from(
                        {
                          length: Math.max(
                            0,
                            (online.game?.size ?? 4) - game.players.length,
                          ),
                        },
                        (_, i) => (
                          <div className="player-row empty-seat" key={i}>
                            <span className="player-avatar">+</span>
                            <div className="player-info">
                              <strong>A seat for a friend</strong>
                              <span>Waiting to join</span>
                            </div>
                          </div>
                        ),
                      )}
                  </div>
                </section>
                {!localMode && (
                  <section className="invite-card">
                    <Icon name="link" size={24} />
                    <h2>Better with your people.</h2>
                    <p>Your next game-night memory starts with a link.</p>
                    <div className="room-code">{roomId}</div>
                    <button className="button button-secondary" onClick={copy}>
                      <Icon
                        name={copyState === "Invite copied!" ? "check" : "copy"}
                        size={17}
                      />
                      {copyState === "Invite copied!"
                        ? copyState
                        : "Copy invite link"}
                    </button>
                    <span className="copy-status" aria-live="polite">
                      {copyState.startsWith("Share") ? copyState : ""}
                    </span>
                  </section>
                )}
                <section className="sidebar-card activity-card">
                  <div className="card-heading">
                    <h2>The play-by-play</h2>
                    <span className="activity-dot" />
                  </div>
                  <ol aria-live="polite">
                    {(localMode
                      ? log
                      : online.events.length
                        ? online.events
                        : ["Your table is ready. Invite your friends!"]
                    ).map((event, i) => (
                      <li key={`${event}-${i}`}>
                        <span />
                        {event}
                      </li>
                    ))}
                  </ol>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>
      <footer className="site-footer">
        <span>A little luck. A lot of good company.</span>
        <span className="tiny-colors">
          <i />
          <i />
          <i />
          <i />
        </span>
      </footer>
    </div>
  );
}
