import type { CardComponent } from "@shared/a2ui";
import { Card as UiCard } from "@/components/ui/card";
import { useSurfaceEnv, type BrickProps } from "./shared";

export function Card({ def, scope }: BrickProps<CardComponent>) {
  const env = useSurfaceEnv();
  const child = env.renderNode(def.child, scope);
  // The surface frame already is a card; a root Card would draw a second border inside it.
  if (def.id === "root" && scope === "/") return <>{child}</>;
  return <UiCard className="gap-0 rounded-lg border p-4 text-base shadow-none ring-0">{child}</UiCard>;
}
