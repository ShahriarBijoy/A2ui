import { useState } from "react";
import type { ImageComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { resolveString } from "@/a2ui/evaluate";
import { imageView, isHttpUrl, type ImageLoad } from "./items";
import { evalCtx, useSurfaceEnv, type BrickProps } from "./shared";

/**
 * A photo whose url came from a data line (the Worker reads the result page's og:image). Nothing
 * until a url exists; then a fixed aspect box, skeleton until it loads, hidden if it fails (imageView).
 */
export function Image({ def, scope }: BrickProps<ImageComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const url = resolveString(def.url, ctx).trim();
  // Keyed on the url: a new picture starts loading from scratch.
  return <ImageBox key={url} url={url} alt={resolveString(def.alt, ctx)} square={def.aspect === "square"} />;
}

function ImageBox(props: { url: string; alt: string; square: boolean }) {
  const [load, setLoad] = useState<ImageLoad>("loading");
  const view = imageView(props.url, load);
  if (view === "hidden") return null;
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg border bg-muted",
        props.square ? "aspect-square max-w-56" : "aspect-video",
      )}
    >
      {view === "skeleton" ? <div aria-hidden className="bb-skeleton absolute inset-0 rounded-none" /> : null}
      {isHttpUrl(props.url) ? (
        <img
          src={props.url}
          alt={props.alt}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoad("loaded")}
          onError={() => setLoad("failed")}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
            view === "image" ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </div>
  );
}
