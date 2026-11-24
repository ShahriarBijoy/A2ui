import type { TimelineComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { toText } from "@/a2ui/evaluate";
import { resolveItems } from "./items";
import { InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

const PENDING_STEPS = 3;

function Dot(props: { last: boolean }) {
  return (
    <span aria-hidden className="flex flex-col items-center">
      <span className="mt-[0.45rem] size-2 shrink-0 rounded-full bg-foreground/75 ring-[3px] ring-card" />
      {props.last ? null : <span className="mt-1.5 w-px flex-1 bg-border" />}
    </span>
  );
}

/** Vertical schedule: times in mono on the left when any step has one, a dot per step, title and detail. */
export function Timeline({ def, scope }: BrickProps<TimelineComponent>) {
  const env = useSurfaceEnv();
  const view = resolveItems(def.items, env.surface.data, scope, env.streaming);
  if (view.kind === "skeleton") {
    return (
      <div aria-hidden className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        {Array.from({ length: PENDING_STEPS }, (_, i) => (
          <div key={i} className="contents">
            <Dot last={i === PENDING_STEPS - 1} />
            <span className={cn("flex flex-col gap-1.5", i < PENDING_STEPS - 1 && "pb-4")}>
              <InlineSkeleton className="h-5 w-40" />
              <InlineSkeleton className="h-4 w-28" />
            </span>
          </div>
        ))}
      </div>
    );
  }
  const steps = (view.kind === "items" ? view.items : []).flatMap((item) => {
    const title = toText(item.title).trim();
    return title ? [{ title, time: toText(item.time).trim(), detail: toText(item.detail).trim() }] : [];
  });
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">Nothing found</p>;
  const timed = steps.some((s) => s.time !== "");
  return (
    <ol className={cn("grid gap-x-3", timed ? "grid-cols-[max-content_auto_minmax(0,1fr)]" : "grid-cols-[auto_minmax(0,1fr)]")}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={i} className="contents">
            {timed ? <span className="pt-0.5 text-right font-mono text-sm whitespace-nowrap text-muted-foreground tabular-nums">{s.time}</span> : null}
            <Dot last={last} />
            <span className={cn("flex min-w-0 flex-col gap-0.5", !last && "pb-4")}>
              <span className="text-base leading-snug font-semibold tracking-[-0.01em]">{s.title}</span>
              {s.detail ? <span className="text-sm leading-snug text-muted-foreground">{s.detail}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
