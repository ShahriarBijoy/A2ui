import type { DividerComponent } from "@shared/a2ui";
import { Separator } from "@/components/ui/separator";
import type { BrickProps } from "./shared";

export function Divider({ def }: BrickProps<DividerComponent>) {
  return <Separator orientation={def.axis === "vertical" ? "vertical" : "horizontal"} />;
}
