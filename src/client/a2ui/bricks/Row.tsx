import type { RowComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { alignClass, justifyClass } from "./layout";
import { renderChildList, useSurfaceEnv, type BrickProps } from "./shared";

export function Row({ def, scope }: BrickProps<RowComponent>) {
  const env = useSurfaceEnv();
  return (
    <div className={cn("bb-row flex flex-row flex-wrap gap-3", justifyClass(def.justify, "start"), alignClass(def.align, "center"))}>
      {renderChildList(env, def.children, scope)}
    </div>
  );
}
