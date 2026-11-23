/**
 * Dev-only fixture runner (mounted by the shell under ?dev, and by dev.html).
 * Each run is a synthetic turn through store.beginTurn/applyTurnEvent, the same single
 * ingress as real turns, so the surface lands in the thread, the wire log and the recordings.
 */
import { useState } from "react";
import type { A2uiMessage } from "@shared/a2ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { store } from "@/store";
import { abortTurn } from "@/turns";
import { FIXTURES, GALLERY, type Fixture } from "./fixtures";

/** Small gaps between messages so the top-down build (U3) is visible. */
const STEP_MS = 90;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseJsonl(text: string): { messages: unknown[]; errors: string[] } {
  const messages: unknown[] = [];
  const errors: string[] = [];
  text.split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      // Composer lines wrap messages as {"a2ui": ...}; accept both shapes.
      const msg = parsed !== null && typeof parsed === "object" && "a2ui" in parsed ? parsed.a2ui : parsed;
      messages.push(msg);
    } catch (err) {
      errors.push("line " + (i + 1) + ": " + (err instanceof Error ? err.message : String(err)));
    }
  });
  return { messages, errors };
}

async function runAsTurn(display: string, messages: readonly unknown[]): Promise<void> {
  abortTurn();
  const turnId = store.beginTurn({ input: { type: "utterance", text: display }, display, via: "text" });
  for (const msg of messages) {
    await sleep(STEP_MS);
    // Raw on purpose: the processor validates and refuses bad messages, which is what the runner is for.
    store.applyTurnEvent(turnId, { type: "a2ui", msg: msg as A2uiMessage, origin: "llm" });
  }
  store.applyTurnEvent(turnId, { type: "done" });
}

export default function DevRunner() {
  const [text, setText] = useState(FIXTURES[0].jsonl);
  const [errors, setErrors] = useState<string[]>([]);

  const runFixture = (f: Fixture) => {
    setText(f.jsonl);
    setErrors([]);
    void runAsTurn("fixture · " + f.label, f.messages);
  };

  const runText = () => {
    const parsed = parseJsonl(text);
    setErrors(parsed.errors);
    if (parsed.messages.length > 0) void runAsTurn("dev runner · " + parsed.messages.length + " lines", parsed.messages);
  };

  const reset = () => {
    abortTurn();
    store.clearThread();
    setErrors([]);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="dev-runner">
      <div className="flex flex-wrap items-center gap-2">
        {[...FIXTURES, GALLERY].map((f) => (
          <Button key={f.id} type="button" variant="outline" size="sm" onClick={() => runFixture(f)}>
            {f.label}
          </Button>
        ))}
        <span className="flex-1" />
        <Button type="button" size="sm" onClick={runText}>
          Run
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={reset}>
          Reset
        </Button>
      </div>
      <Textarea
        aria-label="A2UI JSONL"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-40 field-sizing-fixed font-mono text-xs md:text-xs"
      />
      {errors.length > 0 ? (
        <ul className="font-mono text-xs text-destructive">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
