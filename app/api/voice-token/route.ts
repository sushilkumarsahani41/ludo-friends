import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

/**
 * GET /api/voice-token?room=ABC123&name=Sushil
 * Mints a LiveKit JWT (TTL 2h). Requires env:
 * LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
 */
export async function GET(req: NextRequest) {
  const room = req.nextUrl.searchParams.get("room")?.toUpperCase() ?? "";
  const name = req.nextUrl.searchParams.get("name")?.slice(0, 32) || "guest";
  if (!/^[A-Z0-9]{4,12}$/.test(room)) {
    return NextResponse.json({ error: "bad room" }, { status: 400 });
  }
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) {
    return NextResponse.json(
      { error: "voice not configured — set LIVEKIT_URL/KEY/SECRET" },
      { status: 503 },
    );
  }
  const at = new AccessToken(key, secret, { identity: `${name}-${Math.random().toString(36).slice(2, 7)}`, ttl: "2h" });
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();
  return NextResponse.json({ token, url });
}
