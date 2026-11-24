import { describe, expect, test } from "bun:test";
import type { SurfaceState } from "@/state";
import { DINNER_STEP_2, FLIGHT_SEAT_MAP, GALLERY, NEW_BRICKS, REFUSED } from "./fixtures";
import { applyMessage, DEFAULT_CHECK_MESSAGE } from "./processor";

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

describe("lenient @checks", () => {
  const button = (checks: unknown) => ({
    id: "go",
    component: "Button",
    child: "go_label",
    action: { event: { name: "go" } },
    "@checks": checks,
  });
  const required = { "@call": "required", args: { value: { "@path": "/seat" } } };
  const apply = (checks: unknown) =>
    applyMessage({}, { version: v, updateComponents: { surfaceId: "s1", components: [button(checks)] } }, { now: 1, turnId: "t1" });

  test("a check without a message is kept with a default message, no error", () => {
    const res = apply([{ condition: required }]);
    expect(res.errors).toEqual([]);
    const entry = res.surfaces.s1.components.go;
    expect(entry.status).toBe("ok");
    if (entry.status === "ok") expect(entry.def["@checks"]).toEqual([{ condition: required, message: DEFAULT_CHECK_MESSAGE }]);
  });
  test("a check without a condition is dropped (with an error); the Button and other checks stay", () => {
    const res = apply([{ message: "no condition" }, { condition: required, message: "Pick a seat" }]);
    expect(res.errors).toEqual([
      { code: "VALIDATION_FAILED", surfaceId: "s1", path: "/components/0/@checks/0/condition", message: "A check needs a condition" },
    ]);
    expect(res.refused).toBe(0);
    expect(res.acceptedTypes).toEqual(["Button"]);
    const entry = res.surfaces.s1.components.go;
    expect(entry.status).toBe("ok");
    if (entry.status === "ok") expect(entry.def["@checks"]).toEqual([{ condition: required, message: "Pick a seat" }]);
  });
  test("a check calling an unknown function is dropped, not the Button", () => {
    const res = apply([{ condition: { "@call": "and", args: { values: [{ "@call": "isAdmin" }] } }, message: "x" }]);
    expect(res.errors[0]?.path).toBe("/components/0/@checks/0/condition/args/values/0/@call");
    const entry = res.surfaces.s1.components.go;
    expect(entry.status).toBe("ok");
    if (entry.status === "ok") expect(entry.def["@checks"]).toEqual([]);
  });
  test("@checks that is not a list is removed with an error", () => {
    const res = apply({ condition: required });
    expect(res.errors[0]?.path).toBe("/components/0/@checks");
    const entry = res.surfaces.s1.components.go;
    expect(entry.status).toBe("ok");
    if (entry.status === "ok") expect(entry.def).not.toHaveProperty("@checks");
  });
});

describe("new bricks", () => {
  /** One updateComponents on a fresh surface; returns the entry for each id and the result. */
  function put(components: Record<string, unknown>[]) {
    const { surfaces, results } = run([
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT } },
      { version: v, updateComponents: { surfaceId: "s1", components } },
    ]);
    return { comps: surfaces.s1.components, res: results[1] };
  }
  const status = (components: Record<string, unknown>[], id: string) => put(components).comps[id]?.status;
  const one = (c: Record<string, unknown>) => status([{ id: "x", ...c }], "x");

  test("Icon with an unknown literal name is refused; a bound name is accepted (checked when drawn)", () => {
    expect(one({ component: "Icon", name: "plane" })).toBe("ok");
    expect(one({ component: "Icon", name: "rocket-ship" })).toBe("refused");
    expect(one({ component: "Icon" })).toBe("refused");
    expect(one({ component: "Icon", name: { "@path": "/weather/now/icon" } })).toBe("ok");
    expect(one({ component: "Icon", name: { "@path": "icon" } })).toBe("ok");
    expect(one({ component: "Icon", name: { "@call": "formatString", args: { value: "sun" } } })).toBe("refused");
  });

  test("Icon size outside sm|md|lg is refused", () => {
    for (const size of ["sm", "md", "lg"]) expect(one({ component: "Icon", name: "clock", size })).toBe("ok");
    expect(one({ component: "Icon", name: "clock", size: "xl" })).toBe("refused");
    expect(one({ component: "Icon", name: "clock", size: 24 })).toBe("refused");
  });

  test("Table without columns is refused", () => {
    const rows = [{ name: "A" }];
    expect(one({ component: "Table", rows })).toBe("refused");
    expect(one({ component: "Table", columns: [], rows })).toBe("refused");
    expect(one({ component: "Table", columns: [{ label: "Name" }], rows })).toBe("refused");
    expect(one({ component: "Table", columns: [{ label: "Name", field: "name" }] })).toBe("refused");
  });

  test("Table rows may be a path or a literal array", () => {
    const columns = [{ label: "Name", field: "name" }, { label: "Price", field: "price" }];
    expect(one({ component: "Table", columns, rows: { "@path": "/plans" } })).toBe("ok");
    expect(one({ component: "Table", columns, rows: [{ name: "A", price: null }, { name: "B" }] })).toBe("ok");
    expect(one({ component: "Table", columns, rows: "A, B" })).toBe("refused");
    expect(one({ component: "Table", columns, rows: [1, 2] })).toBe("refused");
  });

  test("Chart items must be a path or an array of {label, value}", () => {
    expect(one({ component: "Chart", items: { "@path": "/prices" }, unit: "€" })).toBe("ok");
    expect(one({ component: "Chart", type: "bar", items: [{ label: "A", value: 3 }, { label: "B", value: 0 }] })).toBe("ok");
    // A numeric string is a number (as for path-bound items); text is not.
    expect(one({ component: "Chart", items: [{ label: "A", value: "3" }] })).toBe("ok");
    expect(one({ component: "Chart", items: [{ label: "A", value: "€3" }] })).toBe("refused");
    expect(one({ component: "Chart", items: [{ value: 3 }] })).toBe("refused");
    expect(one({ component: "Chart" })).toBe("refused");
    expect(one({ component: "Chart", type: "pie", items: [{ label: "A", value: 3 }] })).toBe("refused");
    expect(one({ component: "Chart", type: "area", items: { "@path": "/weather/hours" }, unit: "°" })).toBe("ok");
    expect(one({ component: "Chart", type: "area", items: [{ label: "15:00", value: -1 }, { label: "16:00", value: 2 }] })).toBe("ok");
    expect(one({ component: "Chart", type: "area", items: [{ label: "15:00", value: "cold" }] })).toBe("refused");
  });

  test("weather data that never came (null for an unknown place) deletes the path without an error", () => {
    const { surfaces, results } = run([
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT } },
      { version: v, updateDataModel: { surfaceId: "s1", path: "/weather", value: null } },
      { version: v, updateDataModel: { surfaceId: "s1", path: "/weather", value: { place: "Porto, Portugal", days: [] } } },
      { version: v, updateDataModel: { surfaceId: "s1", path: "/weather", value: null } },
    ]);
    expect(results.every((r) => r.ok && r.errors.length === 0)).toBe(true);
    expect(surfaces.s1.data).toEqual({});
  });

  test("Timeline items must be a path or an array of {title, time?, detail?}", () => {
    expect(one({ component: "Timeline", items: { "@path": "/plan" } })).toBe("ok");
    expect(one({ component: "Timeline", items: [{ title: "Breakfast", time: "09:00" }, { title: "Museum", detail: "2 h" }] })).toBe("ok");
    expect(one({ component: "Timeline", items: [{ time: "09:00" }] })).toBe("refused");
    expect(one({ component: "Timeline" })).toBe("refused");
  });

  test("Image without alt is refused", () => {
    expect(one({ component: "Image", url: { "@path": "image" }, alt: { "@path": "name" } })).toBe("ok");
    expect(one({ component: "Image", url: { "@path": "image" } })).toBe("refused");
    expect(one({ component: "Image", alt: "Photo" })).toBe("refused");
    expect(one({ component: "Image", url: { "@path": "image" }, alt: "Photo", aspect: "tall" })).toBe("refused");
  });

  test("Badge and Alert reject unknown variants", () => {
    for (const variant of ["neutral", "success", "warning", "danger"]) expect(one({ component: "Badge", text: "Open", variant })).toBe("ok");
    expect(one({ component: "Badge", text: "Open", variant: "info" })).toBe("refused");
    expect(one({ component: "Badge" })).toBe("refused");
    for (const variant of ["info", "warning", "success"]) expect(one({ component: "Alert", text: "Heads up", variant })).toBe("ok");
    expect(one({ component: "Alert", title: "T", text: "Heads up", variant: "danger" })).toBe("refused");
    expect(one({ component: "Alert", title: "Only a title" })).toBe("refused");
  });

  test("Accordion items must name child ids and those children are reachable", () => {
    expect(one({ component: "Accordion", items: [{ title: "A", child: "a" }] })).toBe("ok");
    expect(one({ component: "Accordion", items: [] })).toBe("refused");
    expect(one({ component: "Accordion", items: [{ title: "A" }] })).toBe("refused");
    expect(one({ component: "Accordion", items: [{ title: "A", child: 3 }] })).toBe("refused");
  });

  test("Progress needs a value; max must be positive", () => {
    expect(one({ component: "Progress", value: 40 })).toBe("ok");
    expect(one({ component: "Progress", value: { "@path": "/done" }, max: 5, label: "Packed" })).toBe("ok");
    expect(one({ component: "Progress" })).toBe("refused");
    expect(one({ component: "Progress", value: 1, max: 0 })).toBe("refused");
  });

  test("Rating max must be between 1 and 10", () => {
    expect(one({ component: "Rating", value: { "@path": "rating" } })).toBe("ok");
    expect(one({ component: "Rating", value: { "@path": "rating" }, max: 10 })).toBe("ok");
    expect(one({ component: "Rating", value: { "@path": "rating" }, max: 11 })).toBe("refused");
    expect(one({ component: "Rating", value: { "@path": "rating" }, max: 0 })).toBe("refused");
    expect(one({ component: "Rating", value: { "@path": "rating" }, max: 2.5 })).toBe("refused");
    expect(one({ component: "Rating" })).toBe("refused");
  });

  test("OptionCard icon outside the icon set is refused", () => {
    expect(one({ component: "OptionCard", title: "A", icon: "plane" })).toBe("ok");
    expect(one({ component: "OptionCard", title: "A", icon: null })).toBe("ok");
    expect(one({ component: "OptionCard", title: "A", icon: "airplane" })).toBe("refused");
    const action = { event: { name: "go" } };
    expect(status([{ id: "b", component: "Button", child: "l", action, icon: "check" }, { id: "l", component: "Text", text: "Go" }], "b")).toBe("ok");
    expect(status([{ id: "b", component: "Button", child: "l", action, icon: "tick" }, { id: "l", component: "Text", text: "Go" }], "b")).toBe("refused");
  });

  test("a refused new brick leaves the rest of the surface rendering", () => {
    const { comps, res } = put([
      { id: "root", component: "Column", children: ["title", "icon", "badge", "acc"] },
      { id: "title", component: "Text", text: "## Plans" },
      { id: "icon", component: "Icon", name: "rocket-ship" },
      { id: "badge", component: "Badge", text: "Cheapest", variant: "success" },
      { id: "acc", component: "Accordion", items: [{ title: "Details", child: "detail" }] },
      { id: "detail", component: "Text", text: "Fine print" },
    ]);
    expect(comps.icon).toMatchObject({ status: "refused", component: "Icon" });
    for (const id of ["root", "title", "badge", "acc", "detail"]) expect(comps[id].status).toBe("ok");
    expect(res.refused).toBe(1);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].path).toBe("/components/2/name");
  });
});

describe("updateDataModel", () => {
  test("changedPaths and hasDemoData; the creating turn's fill leaves no flash stamp", () => {
    const { surfaces, results } = run([
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT } },
      { version: v, updateDataModel: { surfaceId: "s1", path: "/flights", value: [{ id: "f1", demo: true }] } },
      { version: v, updateDataModel: { surfaceId: "s1", path: "/trip/guests", value: 6 } },
    ]);
    expect(results[1].changedPaths).toEqual(["/flights"]);
    expect(results[2].changedPaths).toEqual(["/trip/guests"]);
    expect(surfaces.s1.changed).toEqual({});
    expect(surfaces.s1.hasDemoData).toBe(true);
    const cleared = applyMessage(surfaces, { version: v, updateDataModel: { surfaceId: "s1", path: "/flights", value: null } }, { now: 4, turnId: null });
    expect(cleared.surfaces.s1.data).toEqual({ trip: { guests: 6 } });
    expect(cleared.surfaces.s1.hasDemoData).toBe(false);
  });
  test("a later turn's edit stamps only the leaves whose value changed", () => {
    const { surfaces } = run([
      { version: v, createSurface: { surfaceId: "s1", catalogId: CAT } },
      { version: v, updateDataModel: { surfaceId: "s1", value: { booking: { place: "P", time: ["19:00"], guests: 4 } } } },
    ]);
    const edit = applyMessage(
      surfaces,
      { version: v, updateDataModel: { surfaceId: "s1", path: "/booking", value: { place: "P", time: ["20:00"], guests: 6 } } },
      { now: 50, turnId: "t2" },
    );
    expect(edit.changedPaths).toEqual(["/booking"]);
    expect(edit.surfaces.s1.changed).toEqual({ "/booking/time/0": 50, "/booking/guests": 50 });
    // Outside a turn (applyA2ui) nothing counts as an edit.
    const quiet = applyMessage(surfaces, { version: v, updateDataModel: { surfaceId: "s1", path: "/booking/guests", value: 8 } }, { now: 60, turnId: null });
    expect(quiet.surfaces.s1.changed).toEqual({});
    // A rewrite at the root still stamps leaves, not "/".
    const root = applyMessage(
      surfaces,
      { version: v, updateDataModel: { surfaceId: "s1", path: "/", value: { booking: { place: "P", time: ["19:00"], guests: 5 } } } },
      { now: 70, turnId: "t3" },
    );
    expect(root.surfaces.s1.changed).toEqual({ "/booking/guests": 70 });
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
  test("dinner, seat map and the galleries apply cleanly", () => {
    for (const f of [DINNER_STEP_2, FLIGHT_SEAT_MAP, GALLERY, NEW_BRICKS]) {
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
