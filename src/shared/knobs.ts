/**
 * Surface → knobs; knobs → Jev questions; Jev answers → patches.
 * OWNER: decision lane. STUB until implemented: signatures are the contract.
 */
import type { CatalogComponent, JsonValue } from "./a2ui";
import type { Knob } from "./protocol";

/** Every input component whose value is {"@path": "/absolute"}. TextField is never a knob. */
export function deriveKnobs(_components: CatalogComponent[], _data: JsonValue, _now: Date = new Date()): Knob[] {
  return [];
}
