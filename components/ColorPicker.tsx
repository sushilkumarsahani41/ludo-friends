"use client";
import type { CSSProperties } from "react";
import { COLORS, type LudoColor } from "@/lib/ludo-engine";
import { PLAYER_COLORS } from "./Board";
import Icon from "./Icon";

export default function ColorPicker({
  value,
  onChange,
  available = COLORS,
  occupied = [],
  disabled = false,
  label = "Your color",
  opposite = false,
}: {
  value?: LudoColor;
  onChange: (color: LudoColor) => void;
  available?: LudoColor[];
  occupied?: { color: LudoColor; name: string }[];
  disabled?: boolean;
  label?: string;
  opposite?: boolean;
}) {
  return (
    <fieldset className="color-picker" disabled={disabled}>
      <legend>
        {label}
        <span>{opposite ? "Opposite seats" : "Make it yours"}</span>
      </legend>
      <div className="color-options">
        {COLORS.map((color) => {
          const taken = occupied.find((p) => p.color === color);
          const unavailable = !available.includes(color);
          return (
            <button
              key={color}
              type="button"
              className={`color-option ${value === color ? "color-selected" : ""}`}
              disabled={disabled || unavailable}
              aria-label={`Choose ${color}${taken ? ` · taken by ${taken.name}` : unavailable ? " · requires opposite seat" : ""}`}
              aria-pressed={value === color}
              onClick={() => onChange(color)}
              title={
                taken
                  ? `Taken by ${taken.name}`
                  : unavailable
                    ? "Two players must sit opposite each other"
                    : `Play as ${color}`
              }
              style={
                { "--player-color": PLAYER_COLORS[color] } as CSSProperties
              }
            >
              <span className="color-swatch">
                {value === color ? (
                  <Icon name="check" size={17} />
                ) : taken ? (
                  <Icon name="close" size={13} />
                ) : null}
              </span>
              <strong>{color}</strong>
              <small>
                {taken
                  ? "Taken"
                  : unavailable
                    ? "Not opposite"
                    : value === color
                      ? "Selected"
                      : "Available"}
              </small>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
