import { describe, expect, test } from "bun:test";
import type { SurfaceState } from "@/state";
import { DINNER_STEP_2, FLIGHT_SEAT_MAP, REFUSED } from "./fixtures";
import { applyMessage } from "./processor";

const CAT = "https://example.test/catalog/brick-box/v1";
const v = "1.0" as const;
type Surfaces = Record<string, SurfaceState>;

function run(messages: unknown[], start: Surfaces = {}, now = 1) {
  let surfaces = start;
  const results = messages.map((m, i) => {
    const res = applyMessage(surfaces, m, { now: now + i, turnId: "t1" });
    surfaces = res.surfaces;
    return res;
  });
  return { surfaces, results };
}

describe("envelope", () => {
  test("unknown message key → error, no state change", () => {
    const { surfaces } = run([{ version: v, createSurface: { surfaceId: "s1", catalogId: CAT } }]);
    const res = applyMessage(surfaces, { version: v, renderHtml: { surfaceId: "s1", html: "<b>" } }, { now: 9, turnId: null });
    expect(res.ok).toBe(false);
    expect(res.kind).toBeUndefined();
    expect(res.surfaces).toBe(surfaces);
    expect(res.errors).toEqual([{ code: "VALIDATION_FAILED", surfaceId: "s1", path: "/", message: expect.stringContaining("renderHtml") }]);
  });
  test("missing version, two keys, non-object → error, no state change", () => {
    const empty: Surfaces = {};
    for (const raw of [
      { createSurface: { surfaceId: "s1", catalogId: CAT } },
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT }, deleteSurface: { surfaceId: "s1" } },
      "not json",
      { version: v },
    ]) {
      const res = applyMessage(empty, raw, { now: 1, turnId: null });
      expect(res.ok).toBe(false);
      expect(res.surfaces).toBe(empty);
      expect(res.errors[0]?.path).toBe("/");
      expect(res.refused).toBe(1);
    }
  });
});

describe("createSurface", () => {
  test("catalogId must end with the catalog path", () => {
    const res = applyMessage({}, { version: v, createSurface: { surfaceId: "s1", catalogId: "https://evil.test/catalog/other" } }, { now: 1, turnId: null });
    expect(res.ok).toBe(false);
    expect(res.surfaces).toEqual({});
    expect(res.errors[0]).toMatchObject({ code: "VALIDATION_FAILED", surfaceId: "s1" });
  });
  test("creates, and re-creating resets", () => {
    const { surfaces } = run([
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT } },
      { version: v, updateDataModel: { surfaceId: "s1", value: { a: 1 } } },
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT } },
    ]);
    expect(surfaces.s1.data).toEqual({});
    expect(surfaces.s1.turnId).toBe("t1");
  });
  test("a late createSurface adopts the surface auto-created earlier in the same turn", () => {
    const { surfaces, results } = run([
      { version: v, updateComponents: { surfaceId: "s3", components: [{ id: "root", component: "Divider" }] } },
      { version: v, updateDataModel: { surfaceId: "s3", path: "/a", value: 1 } },
      { version: v, createSurface: { surfaceId: "s3", catalogId: CAT } },
    ]);
    expect(results[0].created).toBe(true);
    expect(results[2].created).toBe(false);
    expect(surfaces.s3.catalogId).toBe(CAT);
    expect(surfaces.s3.data).toEqual({ a: 1 });
    expect(surfaces.s3.components.root.status).toBe("ok");
    // From another turn, re-creating still resets.
    const reset = applyMessage(surfaces, { version: v, createSurface: { surfaceId: "s3", catalogId: CAT } }, { now: 9, turnId: "t2" });
    expect(reset.surfaces.s3.components).toEqual({});
  });
});

describe("updateComponents", () => {
  test("replace-by-id keeps firstSeen and does not double-count", () => {
    const { surfaces, results } = run([
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT } },
      { version: v, updateComponents: { surfaceId: "s1", components: [{ id: "root", component: "Text", text: "a" }] } },
      { version: v, updateComponents: { surfaceId: "s1", components: [{ id: "root", component: "Text", text: "b" }, { id: "x", component: "Divider" }] } },
    ]);
    expect(results[1].acceptedTypes).toEqual(["Text"]);
    expect(results[2].acceptedTypes).toEqual(["Divider"]);
    const root = surfaces.s1.components.root;
    expect(root.status).toBe("ok");
    expect(root.firstSeen).toBe(2);
    if (root.status === "ok" && root.def.component === "Text") expect(root.def.text).toBe("b");
  });
  test("the same id twice in one message counts once", () => {
    const { results } = run([
      { version: v, updateComponents: { surfaceId: "s1", components: [{ id: "a", component: "Divider" }, { id: "a", component: "Divider" }] } },
    ]);
    expect(results[0].acceptedTypes).toEqual(["Divider"]);
  });
  test("unknown component → refused entry + VALIDATION_FAILED at /components/i/component", () => {
    const { surfaces, results } = run([
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT } },
      {
        version: v,
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "root", component: "Column", children: ["login"] },
            { id: "login", component: "LoginForm" },
          ],
        },
      },
    ]);
    const res = results[1];
    expect(res.ok).toBe(false);
    expect(res.kind).toBe("updateComponents");
    expect(res.refused).toBe(1);
    expect(res.acceptedTypes).toEqual(["Column"]);
    expect(res.errors).toEqual([
      { code: "VALIDATION_FAILED", surfaceId: "s1", path: "/components/1/component", message: 'Unknown component "LoginForm"' },
    ]);
    expect(surfaces.s1.components.login).toMatchObject({ status: "refused", component: "LoginForm" });
    expect(surfaces.s1.components.root.status).toBe("ok");
  });
  test("unknown function anywhere in the props → refused", () => {
    const { surfaces, results } = run([
      {
        version: v,
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "t", component: "Text", text: { "@call": "formatString", args: { value: { "@call": "eval", args: {} } } } },
          ],
        },
      },
    ]);
    expect(results[0].errors[0]).toMatchObject({ path: "/components/0/text/args/value/@call" });
    expect(surfaces.s1.components.t).toMatchObject({ status: "refused", component: "Text", reason: "Unknown function" });
  });
  test("missing required props → refused", () => {
    const { results, surfaces } = run([
      {
        version: v,
        updateComponents: {
          surfaceId: "s1",
          components: [
            { id: "b", component: "Button", child: "l" },
            { id: "o", component: "OptionCard" },
            { id: "m", component: "SeatMap", rows: 10, value: { "@path": "/seat" } },
            { id: "r", component: "Row" },
            { id: "f", component: "TextField" },
          ],
        },
      },
    ]);
    expect(results[0].errors.map((e) => e.path)).toEqual([
      "/components/0/action",
      "/components/1/title",
      "/components/2/layout",
      "/components/3/children",
    ]);
    expect(surfaces.s1.components.f.status).toBe("ok");
  });
  test("unknown surface is auto-created (lenient)", () => {
    const { results, surfaces } = run([{ version: v, updateComponents: { surfaceId: "s4", components: [{ id: "root", component: "Divider" }] } }]);
    expect(results[0].created).toBe(true);
    expect(surfaces.s4.catalogId).toBe("");
  });
});

describe("updateDataModel", () => {
  test("changedPaths, changed stamp, hasDemoData", () => {
    const { surfaces, results } = run([
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT } },
      { version: v, updateDataModel: { surfaceId: "s1", path: "/flights", value: [{ id: "f1", demo: true }] } },
      { version: v, updateDataModel: { surfaceId: "s1", path: "/trip/guests", value: 6 } },
    ]);
    expect(results[1].changedPaths).toEqual(["/flights"]);
    expect(results[2].changedPaths).toEqual(["/trip/guests"]);
    expect(surfaces.s1.changed).toEqual({ "/flights": 2, "/trip/guests": 3 });
    expect(surfaces.s1.hasDemoData).toBe(true);
    const cleared = applyMessage(surfaces, { version: v, updateDataModel: { surfaceId: "s1", path: "/flights", value: null } }, { now: 4, turnId: null });
    expect(cleared.surfaces.s1.data).toEqual({ trip: { guests: 6 } });
    expect(cleared.surfaces.s1.hasDemoData).toBe(false);
  });
  test("path defaults to / and bad paths are rejected", () => {
    const { surfaces } = run([{ version: v, updateDataModel: { surfaceId: "s1", value: { a: 1 } } }]);
    expect(surfaces.s1.data).toEqual({ a: 1 });
    const bad = applyMessage(surfaces, { version: v, updateDataModel: { surfaceId: "s1", path: "a", value: 1 } }, { now: 2, turnId: null });
    expect(bad.ok).toBe(false);
    expect(bad.surfaces).toBe(surfaces);
  });
});

describe("deleteSurface", () => {
  test("removes the surface", () => {
    const { surfaces } = run([
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT } },
      { version: v, deleteSurface: { surfaceId: "s1" } },
    ]);
    expect(surfaces).toEqual({});
  });
});

describe("fixtures", () => {
  test("dinner and seat map apply cleanly", () => {
    for (const f of [DINNER_STEP_2, FLIGHT_SEAT_MAP]) {
      const { results } = run(f.messages);
      expect(results.flatMap((r) => r.errors)).toEqual([]);
    }
  });
  test("refused fixture: two refusals, the rest renders", () => {
    const { results, surfaces } = run(REFUSED.messages);
    const errors = results.flatMap((r) => r.errors);
    expect(errors.map((e) => e.path)).toEqual(["/components/2/component", "/components/3/text/@call"]);
    expect(surfaces.s9.components.guest.status).toBe("ok");
    expect(surfaces.s9.components.title.status).toBe("ok");
  });
});
