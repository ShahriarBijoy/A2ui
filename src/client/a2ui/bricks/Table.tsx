import type { JsonValue, TableComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { resolveString } from "@/a2ui/evaluate";
import { cellText, isHttpUrl, resolveItems } from "./items";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

const PENDING_ROWS = 3;

/** A source URL reads as its host; the full address would push every other column off screen. */
function cell(v: JsonValue | undefined): string {
  const text = cellText(v);
  return typeof v === "string" && isHttpUrl(v) ? new URL(v).hostname.replace(/^www\./, "") : text;
}

/** Read-only comparison (anything the person picks stays an OptionCard). Scrolls sideways inside its own box. */
export function Table({ def, scope }: BrickProps<TableComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const view = resolveItems(def.rows, env.surface.data, scope, env.streaming);
  const columns = def.columns;
  return (
    <div className="w-full overflow-x-auto rounded-lg border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/45">
            {columns.map((col, i) => (
              <th
                key={i}
                scope="col"
                className="px-3 py-2 text-left font-mono text-[0.7rem] font-medium tracking-wider whitespace-nowrap text-muted-foreground uppercase"
              >
                {resolveString(col.label, ctx, col.field)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.kind === "items" ? (
            view.items.map((row, r) => (
              <tr key={typeof row.id === "string" ? row.id : r} className="border-b last:border-0">
                {columns.map((col, c) => (
                  <td
                    key={c}
                    className={cn(
                      "px-3 py-2.5 align-top leading-snug",
                      c === 0 && "font-medium",
                      typeof row[col.field] === "number" && "font-mono tabular-nums",
                    )}
                  >
                    {cell(row[col.field])}
                  </td>
                ))}
              </tr>
            ))
          ) : view.kind === "skeleton" ? (
            Array.from({ length: PENDING_ROWS }, (_, r) => (
              <tr key={"pending" + r} className="border-b last:border-0" aria-hidden>
                {columns.map((_, c) => (
                  <td key={c} className="px-3 py-2.5">
                    <InlineSkeleton className="h-4 w-full max-w-24" />
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-3 py-3 text-sm text-muted-foreground">
                Nothing found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
