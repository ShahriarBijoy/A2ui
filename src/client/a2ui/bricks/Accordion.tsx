import type { AccordionComponent } from "@shared/a2ui";
import { Accordion as UiAccordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { resolveString } from "@/a2ui/evaluate";
import { evalCtx, useSurfaceEnv, type BrickProps } from "./shared";

/** Sections that open and close; the first starts open (the smoke judge reads it the same way). */
export function Accordion({ def, scope }: BrickProps<AccordionComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  return (
    <UiAccordion defaultValue={[0]} className="rounded-lg border bg-card px-4">
      {def.items.map((item, i) => (
        <AccordionItem key={i} value={i}>
          <AccordionTrigger className="py-3 text-base hover:no-underline">{resolveString(item.title, ctx, "Section " + (i + 1))}</AccordionTrigger>
          <AccordionContent className="pb-4 text-base">{env.renderNode(item.child, scope)}</AccordionContent>
        </AccordionItem>
      ))}
    </UiAccordion>
  );
}
