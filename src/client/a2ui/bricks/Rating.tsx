import { Star } from "lucide-react";
import type { RatingComponent } from "@shared/a2ui";
import { isPending, resolve } from "@/a2ui/evaluate";
import { formatAmount, parseRating } from "./items";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

const STARS = 5;
const STAR_PX = 18;

/** Five stars filled to the rating's share of its scale, the number beside. Nothing without a rating. */
export function Rating({ def, scope }: BrickProps<RatingComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  if (env.streaming && isPending(def.value, ctx)) return <InlineSkeleton className="h-5 w-32" />;
  const rating = parseRating(resolve(def.value, ctx), def.max);
  if (!rating) return null;
  const filled = (rating.value / rating.max) * STARS;
  return (
    <span role="img" aria-label={"Rated " + formatAmount(rating.value) + " out of " + formatAmount(rating.max)} className="inline-flex items-center gap-2">
      <span aria-hidden className="inline-flex items-center gap-0.5">
        {Array.from({ length: STARS }, (_, i) => {
          const part = Math.max(0, Math.min(1, filled - i));
          return (
            <span key={i} className="relative inline-block shrink-0" style={{ width: STAR_PX, height: STAR_PX }}>
              <Star size={STAR_PX} strokeWidth={1.5} className="absolute inset-0 text-star/40" />
              <span className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: part * 100 + "%" }}>
                <Star size={STAR_PX} strokeWidth={1.5} fill="currentColor" className="max-w-none text-star" />
              </span>
            </span>
          );
        })}
      </span>
      <span className="font-mono text-sm tabular-nums">
        <span className="font-medium text-foreground">{formatAmount(rating.value)}</span>
        <span className="text-muted-foreground">/{formatAmount(rating.max)}</span>
      </span>
    </span>
  );
}
