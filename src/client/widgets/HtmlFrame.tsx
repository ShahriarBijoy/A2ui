import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const THROTTLE_MS = 300;

/**
 * HTML mode (PLAN §3.8): the model's document in a sandboxed iframe. allow-scripts only, never
 * allow-same-origin, so generated code cannot reach the app, its storage or the demo key.
 */
export function HtmlFrame({ html, streaming = false }: { html: string; streaming?: boolean }) {
  const shown = useThrottled(html, THROTTLE_MS);
  return (
    <figure className="w-full max-w-(--surface-w)">
      <figcaption className="mb-1.5 flex items-center justify-between font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">
        <span>generated HTML · sandboxed</span>
        <span className={cn(!streaming && "invisible")}>streaming</span>
      </figcaption>
      <iframe
        title="Generated HTML"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={shown}
        className="block h-[420px] w-full rounded-xl border bg-white"
      />
    </figure>
  );
}

/** Same frame before the first byte, so the iframe does not push the thread when it appears. */
export function HtmlFrameSkeleton() {
  return (
    <figure className="w-full max-w-(--surface-w)" aria-busy="true">
      <figcaption className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">
        generated HTML · sandboxed
      </figcaption>
      <div className="h-[420px] w-full rounded-xl border bg-card p-5">
        <div className="bb-skeleton h-5 w-2/5" />
        <div className="bb-skeleton mt-4 h-24 w-full" />
      </div>
    </figure>
  );
}

/**
 * Every srcdoc change reloads the iframe, so cap updates at one per `ms` while streaming.
 * The trailing timer guarantees the final chunk is always shown.
 */
function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const lastAt = useRef(0);
  useEffect(() => {
    const wait = ms - (performance.now() - lastAt.current);
    if (wait <= 0) {
      lastAt.current = performance.now();
      setShown(value);
      return;
    }
    const id = window.setTimeout(() => {
      lastAt.current = performance.now();
      setShown(value);
    }, wait);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return shown;
}
