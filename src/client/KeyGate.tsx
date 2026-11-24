import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { checkDemoKey, setDemoKey, type KeyCheck } from "@/apiBase";

const MESSAGES: Record<Exclude<KeyCheck, "ok">, string> = {
  wrong: "That key is not right.",
  busy: "Too many tries. Wait a minute.",
  unreachable: "Cannot reach the server. Check the connection.",
};

/**
 * Shown instead of the app until this browser has a working demo key. The key protects the paid API keys
 * behind /api; it is checked once against the Worker, then remembered (localStorage), so it never has to be
 * in the address bar, where the projector would show it.
 */
export function KeyGate() {
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const k = key.trim();
    if (!k || checking) return;
    setChecking(true);
    setError(null);
    const result = await checkDemoKey(k);
    setChecking(false);
    if (result === "ok") setDemoKey(k);
    else setError(MESSAGES[result]);
  };

  return (
    <div className="grid h-svh place-items-center bg-background px-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-card p-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold tracking-tight">Brick Box</h1>
          <p className="text-sm text-muted-foreground">Enter the demo key. This browser remembers it.</p>
        </div>
        <Input
          type="password"
          name="demo-key"
          aria-label="Demo key"
          placeholder="Demo key"
          autoFocus
          autoComplete="current-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={checking || !key.trim()}>
          {checking ? "Checking…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}
