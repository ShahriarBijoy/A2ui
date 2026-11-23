import { Fragment, type ReactNode } from "react";
import type { JsonValue } from "@shared/a2ui";
import { cn } from "@/lib/utils";

const FLASH_MS = 600;

type Props = {
  value: unknown;
  /** Absolute pointer → performance.now() of the last agent/knob write (SurfaceState.changed). */
  changed?: Readonly<Record<string, number>>;
  className?: string;
};

/** Pretty JSON in mono. With `changed`, freshly written values flash (U5 mirrored in the inspector). */
export function JsonView({ value, changed, className }: Props) {
  return (
    <div className={cn("font-mono text-[0.75rem] leading-[1.55] text-foreground", className)}>
      <Node value={toJson(value)} path="" depth={0} changed={changed} last />
    </div>
  );
}

function toJson(v: unknown): JsonValue {
  if (v === undefined) return null;
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(toJson);
  if (typeof v === "object") {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, val] of Object.entries(v)) if (val !== undefined) out[k] = toJson(val);
    return out;
  }
  return String(v);
}

function escapeToken(k: string): string {
  return k.replace(/~/g, "~0").replace(/\//g, "~1");
}

type NodeProps = {
  value: JsonValue;
  path: string;
  depth: number;
  label?: ReactNode;
  last: boolean;
  changed?: Readonly<Record<string, number>>;
};

function Node({ value, path, depth, label, last, changed }: NodeProps) {
  const at = changed?.[path === "" ? "/" : path];
  const fresh = at !== undefined && performance.now() - at < FLASH_MS;
  const comma = last ? "" : ",";
  const pad = { paddingLeft: `${depth * 1.1}em` };
  let body: ReactNode;

  if (value !== null && typeof value === "object") {
    const isArr = Array.isArray(value);
    const entries: [string, JsonValue][] = isArr ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    const [open, close] = isArr ? ["[", "]"] : ["{", "}"];
    if (entries.length === 0) {
      body = (
        <div style={pad}>
          {label}
          <span className="text-muted-foreground">
            {open}
            {close}
            {comma}
          </span>
        </div>
      );
    } else {
      body = (
        <>
          <div style={pad}>
            {label}
            <span className="text-muted-foreground">{open}</span>
          </div>
          {entries.map(([k, v], i) => (
            <Fragment key={k}>
              <Node
                value={v}
                path={`${path}/${escapeToken(k)}`}
                depth={depth + 1}
                label={isArr ? undefined : <Key name={k} />}
                last={i === entries.length - 1}
                changed={changed}
              />
            </Fragment>
          ))}
          <div style={pad} className="text-muted-foreground">
            {close}
            {comma}
          </div>
        </>
      );
    }
  } else {
    body = (
      <div style={pad} className="break-all">
        {label}
        <Leaf value={value} />
        <span className="text-muted-foreground">{comma}</span>
      </div>
    );
  }

  // Keyed on the write time so a second edit re-triggers the flash.
  return fresh ? (
    <div key={at} className="bb-flash">
      {body}
    </div>
  ) : (
    body
  );
}

function Key({ name }: { name: string }) {
  return <span className="text-muted-foreground">"{name}": </span>;
}

function Leaf({ value }: { value: string | number | boolean | null }) {
  if (typeof value === "string") return <span>"{value}"</span>;
  return <span className="font-medium">{String(value)}</span>;
}
