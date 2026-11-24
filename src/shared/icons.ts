/**
 * The fixed icon set: what the Icon brick (and OptionCard/Button "icon") may name, and what the app chrome uses
 * for session icons. Lowercase, kebab-case. Each maps to a lucide-react component in src/client/iconMap.tsx.
 * A name outside this list is refused like an unknown component.
 */
export const ICON_NAMES = [
  "plane",
  "plane-takeoff",
  "plane-landing",
  "train",
  "bus",
  "car",
  "bike",
  "map-pin",
  "navigation",
  "globe",
  "hotel",
  "bed",
  "home",
  "building",
  "utensils",
  "coffee",
  "wine",
  "beer",
  "pizza",
  "cake",
  "calendar",
  "clock",
  "timer",
  "ticket",
  "music",
  "film",
  "party",
  "trophy",
  "book",
  "briefcase",
  "users",
  "user",
  "baby",
  "dog",
  "accessibility",
  "heart",
  "star",
  "euro",
  "wallet",
  "credit-card",
  "receipt",
  "shopping-bag",
  "gift",
  "sun",
  "cloud",
  "rain",
  "snow",
  "umbrella",
  "leaf",
  "dumbbell",
  "wifi",
  "phone",
  "info",
  "check",
  "alert",
  "x",
  "sparkle",
  "chat",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const ICON_SET = new Set<string>(ICON_NAMES);

export function isIconName(name: unknown): name is IconName {
  return typeof name === "string" && ICON_SET.has(name);
}
