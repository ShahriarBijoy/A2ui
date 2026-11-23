import type { ReactNode } from "react";
import type { TextComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { isPending, resolveString } from "@/a2ui/evaluate";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

const HEADING = ["text-2xl font-semibold tracking-tight", "text-xl font-semibold tracking-tight", "text-lg font-semibold"];

/** "**bold**" spans as React nodes; never HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold">
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

/** Markdown subset: "#", "##", "###" headings and "**bold**". One block per line. */
export function renderMarkdown(text: string): ReactNode[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const m = /^(#{1,3})\s+(.*)$/.exec(line.trim());
      if (!m) return <p key={i}>{inline(line)}</p>;
      const level = m[1].length;
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      return (
        <Tag key={i} className={cn("text-balance", HEADING[level - 1])}>
          {inline(m[2])}
        </Tag>
      );
    });
}

export function Text({ def, scope }: BrickProps<TextComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const caption = def.variant === "caption";
  if (env.streaming && isPending(def.text, ctx)) return <InlineSkeleton className={caption ? "h-4 w-32" : "h-6 w-48"} />;
  const text = resolveString(def.text, ctx);
  return (
    <div
      className={cn(
        "flex flex-col gap-1 leading-snug",
        caption ? "text-sm text-muted-foreground" : "text-base",
      )}
    >
      {renderMarkdown(text)}
    </div>
  );
}
