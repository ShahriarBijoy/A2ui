import type { TabsComponent } from "@shared/a2ui";
import { Tabs as UiTabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveString } from "@/a2ui/evaluate";
import { evalCtx, useSurfaceEnv, type BrickProps } from "./shared";

export function Tabs({ def, scope }: BrickProps<TabsComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  return (
    <UiTabs defaultValue={0}>
      <TabsList className="h-9">
        {def.tabs.map((tab, i) => (
          <TabsTrigger key={i} value={i} className="px-3 text-sm">
            {resolveString(tab.title, ctx, "Tab " + (i + 1))}
          </TabsTrigger>
        ))}
      </TabsList>
      {def.tabs.map((tab, i) => (
        <TabsContent key={i} value={i} className="pt-2 text-base">
          {env.renderNode(tab.child, scope)}
        </TabsContent>
      ))}
    </UiTabs>
  );
}
