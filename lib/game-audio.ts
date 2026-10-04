export type GameSound =
  "roll" | "land" | "six" | "step" | "capture" | "home" | "win";

/** Small synthesized effects: no downloads, media permissions, or background music. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Set<OscillatorNode>();
  private muted = false;

  unlock() {
    try {
      if (!this.context || this.context.state === "closed") {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 0.24;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended")
        void this.context.resume().catch(() => {});
    } catch {
      /* Audio is optional; gameplay still works. */
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.stop();
    if (this.master && this.context)
      this.master.gain.setValueAtTime(
        muted ? 0 : 0.24,
        this.context.currentTime,
      );
  }

  private tone(
    frequency: number,
    delay: number,
    duration: number,
    volume = 0.3,
    endFrequency = frequency,
    type: OscillatorType = "sine",
  ) {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const voice = ctx.createOscillator();
    const envelope = ctx.createGain();
    const start = ctx.currentTime + delay;
    voice.type = type;
    voice.frequency.setValueAtTime(frequency, start);
    voice.frequency.exponentialRampToValueAtTime(
      endFrequency,
      start + duration,
    );
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume, start + 0.004);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    voice.connect(envelope);
    envelope.connect(this.master);
    this.voices.add(voice);
    voice.onended = () => {
      voice.disconnect();
      envelope.disconnect();
      this.voices.delete(voice);
    };
    voice.start(start);
    voice.stop(start + duration + 0.02);
  }

  play(sound: GameSound) {
    // Never queue old sounds while audio is blocked or the tab is hidden.
    if (
      this.muted ||
      this.context?.state !== "running" ||
      document.visibilityState === "hidden"
    )
      return;
    try {
      if (sound === "roll") {
        [0, 0.055, 0.115, 0.18, 0.255, 0.34, 0.435, 0.54].forEach((at, i) =>
          this.tone(260 + (i % 3) * 85, at, 0.055, 0.28, 95, "triangle"),
        );
      } else if (sound === "land") this.tone(240, 0, 0.1, 0.4, 90, "triangle");
      else if (sound === "step")
        this.tone(490, 0, 0.065, 0.24, 230, "triangle");
      else if (sound === "capture") {
        this.tone(540, 0, 0.18, 0.35, 160, "triangle");
        this.tone(220, 0.1, 0.16, 0.25, 90);
      } else {
        const notes =
          sound === "win"
            ? [523.25, 659.25, 783.99, 1046.5]
            : sound === "home"
              ? [659.25, 783.99, 1046.5]
              : [523.25, 783.99];
        notes.forEach((note, i) => this.tone(note, i * 0.105, 0.24, 0.25));
      }
    } catch {
      /* An unavailable audio device must not interrupt a turn. */
    }
  }

  stop() {
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        /* already ended */
      }
    }
    this.voices.clear();
  }
  dispose() {
    this.stop();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
  }
}
