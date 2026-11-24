/** A widget row's source link: only http(s) URLs become links, labelled by their host. */
import type { JsonValue } from "@shared/a2ui";

/** "https://www.example.org/x" → "example.org". */
export function hostLabel(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The URL when it is http(s), else undefined: anything else must never become a link. */
export function httpUrl(v: JsonValue | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
