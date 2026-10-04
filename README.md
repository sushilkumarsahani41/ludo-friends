# Ludo Friends — online web Ludo + voice

Share a link, play 2–4 player Ludo with friends, talk while you play. No install (PWA).

## Run locally (2 terminals)

```bash
npm install
npm run dev            # web on http://localhost:3000 (terminal 1)
npm run dev:socket     # authoritative game server on :4001 (terminal 2)
```

Open `http://localhost:3000`, enter your name, choose 2–4 seats, and create a room.
Share its invite link; the creator starts the game from the waiting lobby once all selected players are connected. Friends opening
an invite are prompted for a name. Refreshing restores the player's existing seat.

**Pass & play** is a separate local mode for sharing one device. Online connection
errors never silently switch to a different local game.

You can also run both servers with `npm run dev:all`.

## Voice chat

The room's **Join voice** button uses browser-to-browser WebRTC audio, with the
Socket.IO server handling authenticated signaling. No LiveKit keys are required
for this UI. Microphone access requires HTTPS or localhost.

Mute/unmute and leave controls are available after joining. Google STUN servers
help establish direct connections; there is currently no TURN relay, so some
restrictive networks may prevent audio. The older LiveKit token route and its
dependencies remain in the repository but are not used by the current voice UI.

## Interface

- Responsive dark slate lobby with vivid player colors with separate create and join flows. Mobile layouts use 44px+ controls, 16px form inputs, safe-area spacing, and a compact waiting lobby without duplicate side panels.
- Shared proportional board, player-colored tokens, safe squares, and legal move highlights.
- The creator chooses a color; friends choose from live available colors before joining. Taken colors are disabled and enforced by the server. Lobby color changes are locked when the game starts.
- Two-player matches always use opposite yards (red/yellow or green/blue); tokens hop square by square when moving. Captured tokens slide back to their yards after the attacker lands.
- A single legal token moves automatically after the dice reveal; multiple legal tokens still require a choice. Online auto-moves run on the server, including automatic turns.
- Extra token buttons for easier touch and keyboard operation.
- Live player roster, turn countdown, invite copying, voice controls, and activity feed.
- Dice tumble through changing faces before revealing the result in local and online games, including automatic turns.
- Synthesized sound effects for dice, token steps, captures, home arrivals, and wins. The Sound on/off toggle remembers your preference and is separate from voice chat. Audio starts after a page interaction and stays quiet in hidden tabs.
- Reduced-motion support, visible keyboard focus, and explicit loading/error states.

## Deploy with Docker and one public hostname

```sh
git clone https://github.com/sushilkumarsahani41/ludo-friends.git
cd ludo-friends
docker compose up -d --build
```

Compose runs Next.js, a single authoritative Socket.IO process, and an Nginx gateway. Only the gateway publishes a port; `/socket.io/` routes internally to the game server and all other app requests to Next.js. Leave `NEXT_PUBLIC_SOCKET_URL` empty so browsers use the same origin.

The default gateway is `http://127.0.0.1:8088`. If the tunnel connector is on another machine, set `LUDO_BIND_ADDRESS` to the Docker host's LAN address in `.env`. Point the Cloudflare Tunnel HTTP service at that address on port 8088, without a path filter. Cloudflare handles public HTTPS and WebSocket upgrades. Set `CORS_ORIGIN=https://your-public-hostname` in `.env` after choosing the hostname, then run `docker compose up -d`.

Use `/health` to check the game server and `docker compose ps` / `docker compose logs --tail=100` to inspect the stack. To update, run `git pull --ff-only` and `docker compose up -d --build`.

Rooms live in memory: restarting the socket container ends active games. Run one socket replica. Voice signaling uses the same gateway; microphone access requires HTTPS (or localhost). Voice media travels peer-to-peer and currently uses STUN only, so restrictive networks may need a TURN relay.

Vercel remains an optional frontend deployment when a separate socket URL is supplied at build time.

## Scripts

- `npm test` — Ludo rules and room seating/reconnect tests (Vitest)
- `npm run build` — production build
- `npm run start` + `npm run start:socket` — prod run

## Structure

- `lib/ludo-engine.ts` — authoritative rules (shared client/server)
- `server/` — Socket.io rooms, 30s timers, rate-limit, auto-play on timeout
- `app/room/[id]/` — board + dice + online/local mode + voice
- `components/VoiceBar.tsx` + `hooks/useVoiceMesh.ts` — opt-in WebRTC room voice
- `app/api/voice-token/` — legacy LiveKit token route (not used by the UI)
