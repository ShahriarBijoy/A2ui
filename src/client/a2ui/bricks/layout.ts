import type { Align, Justify } from "@shared/a2ui";

export const JUSTIFY: Record<Justify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  spaceBetween: "justify-between",
  spaceAround: "justify-around",
  spaceEvenly: "justify-evenly",
  stretch: "justify-stretch",
};

export const ALIGN: Record<Align, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

/** Model output is not type-checked: unknown values fall back instead of producing "undefined". */
export function justifyClass(v: string | undefined, fallback: Justify): string {
  return JUSTIFY[(v ?? fallback) as Justify] ?? JUSTIFY[fallback];
}
export function alignClass(v: string | undefined, fallback: Align): string {
  return ALIGN[(v ?? fallback) as Align] ?? ALIGN[fallback];
}
