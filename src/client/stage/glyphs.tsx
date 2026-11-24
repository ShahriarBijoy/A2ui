/**
 * Small drawings of each brick for the pool tiles (28×20 viewBox, drawn in currentColor so the tile's state colours
 * them). Keyed by catalog name. Covers today's 17 bricks and the ten the catalog is gaining, so the pool never shows
 * a brick without its drawing.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Filled parts: no stroke, the tile's colour as fill. */
const F = { fill: "currentColor", stroke: "none" } as const;

export const BRICK_GLYPHS: Readonly<Record<string, ReactNode>> = {
  Card: <rect x="2" y="2" width="24" height="16" rx="3" />,
  Row: (
    <>
      <rect x="2" y="5" width="6.5" height="10" rx="1.5" />
      <rect x="10.75" y="5" width="6.5" height="10" rx="1.5" />
      <rect x="19.5" y="5" width="6.5" height="10" rx="1.5" />
    </>
  ),
  Column: (
    <>
      <rect x="5" y="2" width="18" height="4" rx="1.5" />
      <rect x="5" y="8" width="18" height="4" rx="1.5" />
      <rect x="5" y="14" width="18" height="4" rx="1.5" />
    </>
  ),
  List: (
    <>
      <circle cx="5" cy="5" r="1.5" {...F} />
      <path d="M9 5h15" />
      <circle cx="5" cy="10" r="1.5" {...F} />
      <path d="M9 10h15" />
      <circle cx="5" cy="15" r="1.5" {...F} />
      <path d="M9 15h11" />
    </>
  ),
  Divider: (
    <>
      <path d="M3 10h22" />
      <path d="M3 5h12" opacity=".35" />
      <path d="M3 15h16" opacity=".35" />
    </>
  ),
  Tabs: (
    <>
      <rect x="2" y="7" width="24" height="11" rx="2" />
      <rect x="2" y="2" width="8" height="5" rx="1.5" {...F} />
      <rect x="11" y="2" width="8" height="5" rx="1.5" />
    </>
  ),
  Text: <path d="M3 5h22M3 10h18M3 15h12" />,
  Button: <rect x="3" y="5" width="22" height="10" rx="5" {...F} />,
  TextField: (
    <>
      <rect x="2" y="5" width="24" height="10" rx="2.5" />
      <path d="M7 7.5v5" />
    </>
  ),
  ChoicePicker: (
    <>
      <rect x="1.5" y="6" width="7.5" height="8" rx="4" {...F} />
      <rect x="10.25" y="6" width="7.5" height="8" rx="4" />
      <rect x="19" y="6" width="7.5" height="8" rx="4" />
    </>
  ),
  Slider: (
    <>
      <path d="M3 10h22" />
      <circle cx="16" cy="10" r="3.4" {...F} />
    </>
  ),
  CheckBox: (
    <>
      <rect x="7" y="3" width="14" height="14" rx="3" />
      <path d="M10.5 10.2l2.4 2.4 4.6-5" />
    </>
  ),
  DateTimeInput: (
    <>
      <rect x="4" y="3.5" width="20" height="14.5" rx="2.5" />
      <path d="M4 8h20M9 1.5v4M19 1.5v4" />
    </>
  ),
  Stepper: (
    <>
      <rect x="2" y="5" width="7" height="10" rx="2" />
      <path d="M4 10h3" />
      <rect x="19" y="5" width="7" height="10" rx="2" />
      <path d="M21 10h3M22.5 8.5v3" />
      <path d="M12.5 8h3M14 8v5" />
    </>
  ),
  OptionCard: (
    <>
      <rect x="2" y="3" width="24" height="14" rx="2.5" />
      <path d="M6 8h9M6 12h6" />
      <path d="M19 8h3" />
    </>
  ),
  SeatMap: (
    <>
      <rect x="3" y="3" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="3" width="4.5" height="4.5" rx="1" />
      <rect x="15" y="3" width="4.5" height="4.5" rx="1" />
      <rect x="21" y="3" width="4.5" height="4.5" rx="1" />
      <rect x="3" y="12" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="12" width="4.5" height="4.5" rx="1" {...F} />
      <rect x="15" y="12" width="4.5" height="4.5" rx="1" />
      <rect x="21" y="12" width="4.5" height="4.5" rx="1" />
    </>
  ),
  Stat: (
    <>
      <path d="M4 16V9" />
      <path d="M4 16h20" opacity=".35" />
      <text x="16" y="14.5" textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="Geist Variable, sans-serif" {...F}>
        42
      </text>
    </>
  ),
  Icon: (
    <>
      <circle cx="14" cy="10" r="7.5" />
      <path d="M14 6.2l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z" {...F} />
    </>
  ),
  Table: (
    <>
      <rect x="2" y="3" width="24" height="14" rx="2" />
      <path d="M2 8h24M2 12.5h24M11 3v14" />
    </>
  ),
  Chart: (
    <>
      <path d="M3 17.5h22" />
      <rect x="5" y="9" width="3.5" height="8" {...F} />
      <rect x="11" y="5" width="3.5" height="12" {...F} />
      <rect x="17" y="11" width="3.5" height="6" {...F} />
    </>
  ),
  Timeline: (
    <>
      <path d="M7 2v16" />
      <circle cx="7" cy="5" r="2.1" {...F} />
      <circle cx="7" cy="14" r="2.1" />
      <path d="M12 5h12M12 14h9" />
    </>
  ),
  Image: (
    <>
      <rect x="2" y="3" width="24" height="14" rx="2" />
      <path d="M4 15.5l6-6 4 4 3-3 7 5" />
      <circle cx="19" cy="7.2" r="1.7" {...F} />
    </>
  ),
  Badge: (
    <>
      <rect x="5" y="6" width="18" height="8" rx="4" />
      <circle cx="9.5" cy="10" r="1.7" {...F} />
      <path d="M13 10h6" />
    </>
  ),
  Alert: (
    <>
      <rect x="2" y="3" width="24" height="14" rx="2.5" />
      <path d="M8 7v3.5" />
      <circle cx="8" cy="13.3" r="1" {...F} />
      <path d="M12 8h10M12 12h7" />
    </>
  ),
  Accordion: (
    <>
      <rect x="2" y="2" width="24" height="5" rx="1.5" />
      <rect x="2" y="9" width="24" height="9" rx="1.5" />
      <path d="M20 4l1.5 1.3L23 4" />
      <path d="M5 12.5h12M5 15.5h8" opacity=".5" />
    </>
  ),
  Progress: (
    <>
      <rect x="2" y="7" width="24" height="6" rx="3" />
      <rect x="2" y="7" width="15" height="6" rx="3" {...F} />
    </>
  ),
  Rating: (
    <>
      <path d="M5 5.5l1.2 2.5 2.7.4-2 1.9.5 2.7L5 11.7l-2.4 1.3.5-2.7-2-1.9 2.7-.4z" {...F} />
      <path d="M14 5.5l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z" {...F} />
      <path d="M23 5.5l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z" />
    </>
  ),
};

/** The ten bricks added for the talk: their tiles carry a "new" dot. */
export const NEW_BRICK_NAMES: ReadonlySet<string> = new Set([
  "Icon",
  "Table",
  "Chart",
  "Timeline",
  "Image",
  "Badge",
  "Alert",
  "Accordion",
  "Progress",
  "Rating",
]);

export function BrickGlyph({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 28 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("bb-glyph", className)}
    >
      {BRICK_GLYPHS[name] ?? <rect x="4" y="4" width="20" height="12" rx="2.5" strokeDasharray="2 2" />}
    </svg>
  );
}
