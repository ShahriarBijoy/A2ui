import type { ListComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { renderChildList, useSurfaceEnv, type BrickProps } from "./shared";

export function List({ def, scope }: BrickProps<ListComponent>) {
  const env = useSurfaceEnv();
  const horizontal = def.direction === "horizontal";
  return (
    <div
      className={cn(
        "flex gap-2.5",
        horizontal ? "flex-row overflow-x-auto pb-1 *:w-60 *:shrink-0" : "flex-col",
      )}
    >
      {renderChildList(env, def.children, scope)}
    </div>
  );
}
