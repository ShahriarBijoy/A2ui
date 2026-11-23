/** Placeholder shell (step 1). The shell lane replaces this file. */
export default function App() {
  return (
    <div className="grid h-svh grid-cols-[15rem_1fr_22rem] grid-rows-[1fr_auto]">
      <aside className="border-r p-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">Brick pool</aside>
      <main className="p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Brick Box</h1>
        <p className="text-muted-foreground">Thread</p>
      </main>
      <aside className="border-l p-4 font-mono text-xs uppercase tracking-wider text-muted-foreground">Inspector</aside>
      <footer className="col-span-3 border-t p-4 font-mono text-xs text-muted-foreground">Transcript · Mode · Decision model</footer>
    </div>
  );
}
