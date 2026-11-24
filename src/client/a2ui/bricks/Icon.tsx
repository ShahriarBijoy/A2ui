import type { IconComponent } from "@shared/a2ui";
import { isIconName, type IconName } from "@shared/icons";
import { ICONS } from "@/iconMap";
import { cn } from "@/lib/utils";
import type { BrickProps } from "./shared";

const SIZE = { sm: 16, md: 20, lg: 28 } as const;

/** One stroke weight for every icon a brick draws, so mixed bricks never look mixed. */
export const BRICK_ICON_STROKE = 1.75;

/** A catalog icon by name; nothing for a name outside the set (validation already refuses those). */
export function BrickIcon(props: { name: IconName | null | undefined; size: number; className?: string }) {
  if (!isIconName(props.name)) return null;
  const Glyph = ICONS[props.name];
  return <Glyph aria-hidden focusable="false" size={props.size} strokeWidth={BRICK_ICON_STROKE} className={cn("shrink-0", props.className)} />;
}

export function Icon({ def }: BrickProps<IconComponent>) {
  const size = SIZE[def.size ?? "md"] ?? SIZE.md;
  return (
    <span className="inline-flex text-foreground">
      <BrickIcon name={def.name} size={size} />
    </span>
  );
}
