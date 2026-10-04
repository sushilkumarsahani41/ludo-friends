"use client";
import { useVoiceMesh } from "@/hooks/useVoiceMesh";
import Icon from "./Icon";
export default function VoiceBar({
  roomId,
  name,
}: {
  roomId: string;
  name: string;
}) {
  const { status, muted, peers, join, leave, toggleMute } = useVoiceMesh(
    roomId,
    name,
  );
  const talking = peers.filter((p) => p.talking).map((p) => p.name);
  return (
    <div className={`voice-bar ${status === "on" ? "voice-active" : ""}`}>
      <span className="voice-icon">
        <Icon name={muted && status === "on" ? "mute" : "mic"} size={22} />
      </span>
      <div className="voice-copy">
        <strong>
          {status === "on"
            ? muted
              ? "Your mic is muted"
              : "You’re at the table"
            : "Good games deserve good conversation."}
        </strong>
        <span aria-live="polite">
          {status === "off"
            ? "Hop on voice and say hello."
            : status === "joining"
              ? "Connecting to your friends…"
              : status === "blocked"
                ? "Allow microphone access in your browser, then retry."
                : status === "error"
                  ? "Voice couldn’t connect. You can still keep playing."
                  : talking.length
                    ? `${talking.join(", ")} speaking`
                    : peers.length
                      ? `${peers.length} friend${peers.length === 1 ? "" : "s"} on voice`
                      : "Waiting for friends to join voice."}
        </span>
      </div>
      <div className="voice-actions">
        {status === "on" ? (
          <>
            <button
              className="icon-button"
              onClick={toggleMute}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              aria-pressed={muted}
            >
              <Icon name={muted ? "mute" : "mic"} size={18} />
            </button>
            <button className="text-button" onClick={leave}>
              Leave
            </button>
          </>
        ) : (
          <button
            className="button button-dark"
            onClick={join}
            disabled={status === "joining"}
          >
            {status === "joining"
              ? "Joining…"
              : status === "off"
                ? "Join voice"
                : "Retry voice"}
          </button>
        )}
      </div>
    </div>
  );
}
