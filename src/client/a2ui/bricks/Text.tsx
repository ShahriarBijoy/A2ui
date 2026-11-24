import type { ReactNode } from "react";
import type { TextComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { isPending, resolveString } from "@/a2ui/evaluate";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

/** "#", "##", "###": bold with tight tracking, like a product heading; "##" is the usual screen title. */
const HEADING = [
  "text-[1.75rem] leading-[1.15] font-bold tracking-[-0.03em]",
  "text-[1.5rem] leading-tight font-bold tracking-[-0.025em]",
  "text-lg leading-snug font-semibold tracking-[-0.01em]",
];

/** Body by default; "caption" and "subtitle" are muted (a subtitle is the one short line under a "##" heading). */
const VARIANT = {
  body: "text-base",
  caption: "bb-caption text-sm text-muted-foreground",
  subtitle: "bb-subtitle text-[0.9375rem] text-muted-foreground",
} as const;

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
  const variant = def.variant === "caption" || def.variant === "subtitle" ? def.variant : "body";
  if (env.streaming && isPending(def.text, ctx)) return <InlineSkeleton className={variant === "body" ? "h-6 w-48" : "h-4 w-32"} />;
  const text = resolveString(def.text, ctx);
  return (
    <div className={cn("flex flex-col gap-1 leading-snug", VARIANT[variant])}>
      {renderMarkdown(text)}
    </div>
  );
}
