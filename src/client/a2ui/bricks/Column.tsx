import type { ColumnComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { alignClass, justifyClass } from "./layout";
import { renderChildList, useSurfaceEnv, type BrickProps } from "./shared";

export function Column({ def, scope }: BrickProps<ColumnComponent>) {
  const env = useSurfaceEnv();
  return (
    <div className={cn("flex flex-col gap-4", justifyClass(def.justify, "start"), alignClass(def.align, "stretch"))}>
      {renderChildList(env, def.children, scope)}
    </div>
  );
}
