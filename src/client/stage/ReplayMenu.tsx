import { HistoryIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { replayer, SLOT_COUNT } from "@/replay";
import { playSlot } from "@/shortcuts";
import { STAGE_BUTTON } from "./styles";

/** F1–F6 as a menu: the same replays the keys play, for when the keyboard is out of reach. */
export function ReplayMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className={STAGE_BUTTON} />}>
        <HistoryIcon aria-hidden />
        Replays
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bb-chrome max-w-[26rem] min-w-80 p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pt-1 pb-1.5 font-mono text-[0.6875rem] tracking-[0.12em] uppercase">
            Recorded turns · play offline
          </DropdownMenuLabel>
          <ReplayItems />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mounted when the menu opens, so it always lists the current keys (a Shift+R save can fill one). */
function ReplayItems() {
  const slots = replayer.slots();
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const rec = slots[i];
    const slot = i + 1;
    return (
      <DropdownMenuItem key={slot} disabled={!rec} onClick={() => playSlot(slot)} className="gap-2.5 px-2 py-1.5 text-[0.8125rem]">
        <Kbd className="h-5 min-w-7 border border-input bg-background font-mono text-[0.6875rem] text-foreground">F{slot}</Kbd>
        <span className="min-w-0 flex-1 truncate" title={rec?.display}>
          {rec ? rec.display : "empty"}
        </span>
      </DropdownMenuItem>
    );
  });
}
