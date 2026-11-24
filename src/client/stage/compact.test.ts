import { describe, expect, test } from "bun:test";
import { BRICK_NAMES } from "@shared/catalog";
import type { FetchMetrics } from "@/state";
import { compactLines, jsonTokens, MAX_STRING, messageName, pairFetches, payloadSizes, prettyRows, truncate, type TurnMessage } from "./compact";

const V = "1.0";
const comps = (components: object[], surfaceId = "s1"): TurnMessage => ({
  msg: { version: V, updateComponents: { surfaceId, components } },
  origin: "llm",
});
const dataModel = (path: string, value: unknown, origin: TurnMessage["origin"] = "llm"): TurnMessage => ({
  msg: { version: V, updateDataModel: { surfaceId: "s1", path, value } },
  origin,
});
const fetchOk = (query: string, records: number, source: FetchMetrics["source"] = "search"): FetchMetrics => ({
  source,
  query,
  ok: true,
  records,
  ms: 2700,
});
const texts = (messages: TurnMessage[], fetches: FetchMetrics[] = []) => compactLines(messages, fetches).map((l) => l.text);

/** One component of every brick, with the line the JSON stream shows for it. */
const EVERY_BRICK: [object, string][] = [
  [{ id: "root", component: "Card", child: "main" }, "root = Card(main)"],
  [{ id: "main", component: "Column", children: ["head", "kpis", "chart"], align: "stretch" }, "main = Column([head, kpis, chart], align=stretch)"],
  [{ id: "kpis", component: "Row", children: ["a", "b"], justify: "spaceBetween" }, "kpis = Row([a, b], justify=spaceBetween)"],
  [
    { id: "list", component: "List", children: { path: "/flights", componentId: "flight" }, direction: "vertical" },
    'list = List(path="/flights", item=flight, direction=vertical)',
  ],
  [{ id: "head", component: "Text", text: "## Weather", variant: "subtitle" }, 'head = Text("## Weather", variant=subtitle)'],
  [{ id: "div", component: "Divider", axis: "horizontal" }, "div = Divider(axis=horizontal)"],
  [{ id: "tabs", component: "Tabs", tabs: [{ title: "A", child: "x" }, { title: "B", child: "y" }] }, "tabs = Tabs(tabs=[2 × {title, child}])"],
  [
    {
      id: "go",
      component: "Button",
      child: "go_label",
      variant: "primary",
      action: { event: { name: "confirm_trip", context: { a: 1 } } },
      "@checks": [{ condition: { "@call": "required", args: { value: { "@path": "/trip/seat" } } }, message: "Pick a seat" }],
      icon: "check",
    },
    "go = Button(go_label, variant=primary, action=confirm_trip, checks=[1 × {condition, message}], icon=check)",
  ],
  [
    { id: "name", component: "TextField", label: "Name", value: { "@path": "/trip/name" }, placeholder: "Your name", variant: "shortText" },
    'name = TextField(label="Name", value=@/trip/name, placeholder="Your name", variant=shortText)',
  ],
  [
    {
      id: "time",
      component: "ChoicePicker",
      label: "Time",
      options: [
        { label: "19:00", value: "19:00" },
        { label: "20:00", value: "20:00" },
      ],
      value: { "@path": "/booking/time" },
      variant: "mutuallyExclusive",
    },
    'time = ChoicePicker(label="Time", options=[2 × {label, value}], value=@/booking/time, variant=mutuallyExclusive)',
  ],
  [
    { id: "budget", component: "Slider", label: "Budget", min: 0, max: 500, steps: 10, value: { "@path": "/trip/budget" } },
    'budget = Slider(label="Budget", min=0, max=500, steps=10, value=@/trip/budget)',
  ],
  [{ id: "bags", component: "CheckBox", label: "Bags", value: { "@path": "/trip/bags" } }, 'bags = CheckBox(label="Bags", value=@/trip/bags)'],
  [
    { id: "date", component: "DateTimeInput", label: "Date", value: { "@path": "/trip/date" }, enableDate: true, enableTime: false },
    'date = DateTimeInput(label="Date", value=@/trip/date, enableDate=true, enableTime=false)',
  ],
  [
    { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 8, value: { "@path": "/booking/guests" } },
    'guests = Stepper(label="Guests", min=1, max=8, value=@/booking/guests)',
  ],
  [
    {
      id: "flight",
      component: "OptionCard",
      title: { "@path": "carrier" },
      subtitle: { "@path": "route" },
      price: { "@path": "price" },
      action: { event: { name: "pick_flight", context: { id: { "@path": "id" } } } },
      icon: "plane",
    },
    "flight = OptionCard(title=@carrier, subtitle=@route, price=@price, action=pick_flight, icon=plane)",
  ],
  [{ id: "seat", component: "SeatMap", rows: 24, layout: "ABC DEF", value: { "@path": "/seat" } }, 'seat = SeatMap(rows=24, layout="ABC DEF", value=@/seat)'],
  [
    {
      id: "each",
      component: "Stat",
      label: "Each",
      value: { "@call": "formatCurrency", args: { value: { "@path": "/split/each" }, currency: "EUR" } },
      unit: "per person",
    },
    'each = Stat(label="Each", value=formatCurrency(value=@/split/each, currency="EUR"), unit="per person")',
  ],
  [{ id: "sun", component: "Icon", name: "sun", size: "lg" }, "sun = Icon(name=sun, size=lg)"],
  [
    {
      id: "cmp",
      component: "Table",
      columns: [
        { label: "Plan", field: "name" },
        { label: "Price", field: "price" },
      ],
      rows: { "@path": "/plans" },
    },
    "cmp = Table(columns=[2 × {label, field}], rows=@/plans)",
  ],
  [
    {
      id: "bars",
      component: "Chart",
      type: "bar",
      items: [
        { label: "A", value: 1 },
        { label: "B", value: 2 },
        { label: "C", value: 3 },
      ],
      unit: "€",
    },
    'bars = Chart(type=bar, items=[3 × {label, value}], unit="€")',
  ],
  [{ id: "plan", component: "Timeline", items: { "@path": "/plan" } }, "plan = Timeline(items=@/plan)"],
  [{ id: "photo", component: "Image", url: { "@path": "image" }, alt: { "@path": "name" }, aspect: "wide" }, "photo = Image(url=@image, alt=@name, aspect=wide)"],
  [{ id: "open", component: "Badge", text: "Open now", variant: "success" }, 'open = Badge(text="Open now", variant=success)'],
  [
    { id: "tip", component: "Alert", title: "Heads up", text: "Bring an umbrella", variant: "info" },
    'tip = Alert(title="Heads up", text="Bring an umbrella", variant=info)',
  ],
  [{ id: "faq", component: "Accordion", items: [{ title: "Q1", child: "a1" }] }, "faq = Accordion(items=[1 × {title, child}])"],
  [{ id: "prog", component: "Progress", value: { "@path": "/done" }, max: 10, label: "Packed" }, 'prog = Progress(value=@/done, max=10, label="Packed")'],
  [{ id: "stars", component: "Rating", value: { "@path": "rating" }, max: 5 }, "stars = Rating(value=@rating, max=5)"],
];

describe("compactLines: components", () => {
  test("covers every brick in the catalog", () => {
    const covered = new Set(EVERY_BRICK.map(([c]) => (c as { component: string }).component));
    for (const name of BRICK_NAMES) expect(covered.has(name)).toBe(true);
  });

  test("one line per component in call syntax: positional first prop, bindings as @path, actions by name", () => {
    expect(texts([comps(EVERY_BRICK.map(([c]) => c))])).toEqual(EVERY_BRICK.map(([, line]) => line));
  });

  test("lines carry their component id and number continuously across messages", () => {
    const lines = compactLines([comps([{ id: "root", component: "Card", child: "main" }]), comps([{ id: "main", component: "Column", children: [] }])]);
    expect(lines.map((l) => [l.n, l.id, l.msg, l.kind])).toEqual([
      [1, "root", 0, "component"],
      [2, "main", 1, "component"],
    ]);
  });

  test("long literals are cut with an ellipsis, short ones stay whole", () => {
    const long = "Tonight, after the event · Konsul-Smidt-Straße 8p";
    const [line] = texts([comps([{ id: "when", component: "Text", text: long, variant: "caption" }])]);
    expect(line).toBe('when = Text("Tonight, after the event ·…", variant=caption)');
    expect(truncate(long, MAX_STRING).length).toBeLessThanOrEqual(MAX_STRING);
    expect(truncate("short", MAX_STRING)).toBe("short");
  });

  test("one-argument calls read positionally; literal arrays show at most four items", () => {
    const [a, b] = texts([
      comps([
        { id: "g", component: "Text", text: { "@call": "formatString", args: { value: "${/booking/guests} guests" } } },
        { id: "o", component: "OptionCard", title: "X", tags: ["a", "b", "c", "d", "e", "f"] },
      ]),
    ]);
    expect(a).toBe('g = Text(formatString("${/booking/guests} guests"))');
    expect(b).toBe('o = OptionCard(title="X", tags=["a", "b", "c", "d", …+2])');
  });
});

describe("compactLines: surfaces, data and renderer lines", () => {
  test("createSurface names the catalog by its short id; deleteSurface by surface", () => {
    expect(
      texts([
        { msg: { version: V, createSurface: { surfaceId: "s5", catalogId: "http://localhost:5191/catalog/brick-box/v1" } }, origin: "llm" },
        { msg: { version: V, deleteSurface: { surfaceId: "s4" } }, origin: "llm" },
      ]),
    ).toEqual(['s5 = Surface(catalog="brick-box/v1")', "deleteSurface(s4)"]);
  });

  test("a data line shows its path, source, query and record count", () => {
    const rows = [{ id: "r1" }, { id: "r2" }, { id: "r3" }];
    const lines = compactLines([dataModel("/flights", rows, "data")], [fetchOk("flights Bremen → New York", 3)]);
    expect(lines.map((l) => [l.text, l.kind, l.origin, l.path])).toEqual([
      ['/flights ← search("flights Bremen → New York", 3 records)', "data", "data", "/flights"],
    ]);
  });

  test("the fetch's own source names the call (a weather line delivers one object)", () => {
    const lines = texts([dataModel("/weather", { place: "Oslo" }, "data")], [fetchOk("Oslo", 1, "weather" as FetchMetrics["source"])]);
    expect(lines).toEqual(['/weather ← weather("Oslo", 1 record)']);
  });

  test("a second write to the same path (pictures filled in) has no fetch of its own", () => {
    const rows = [{ id: "r1" }, { id: "r2" }];
    expect(texts([dataModel("/results", rows, "data"), dataModel("/results", rows, "data")], [fetchOk("bistros", 2)])).toEqual([
      '/results ← search("bistros", 2 records)',
      "/results ← 2 records · again",
    ]);
  });

  test("a failed search pairs with its empty write; a fetch that wrote nothing gets its own line", () => {
    const failed: FetchMetrics = { source: "search", query: "q1", ok: false, records: 0, ms: 0, error: "too many searches" };
    const notWritten: FetchMetrics = { source: "search", query: "q2", ok: true, records: 0, ms: 900 };
    expect(texts([dataModel("/a", [], "data")], [failed, notWritten])).toEqual([
      '/a ← search("q1", failed: too many searches)',
      '∅ ← search("q2", 0 records)',
    ]);
  });

  test("data-model updates from the composer and the decision model print their values", () => {
    const lines = compactLines([dataModel("/booking", { guests: 6, time: "21:00" }), dataModel("/booking/guests", 6, "knob")]);
    expect(lines.map((l) => [l.text, l.origin])).toEqual([
      ['/booking ← {guests: 6, time: "21:00"}', "llm"],
      ["/booking/guests ← 6", "knob"],
    ]);
  });

  test("renderer refusals and actions are their own lines; junk is marked, never dropped", () => {
    const lines = compactLines([
      { msg: { version: V, action: { name: "pick_flight", context: { id: "r1", carrier: "Lufthansa" } } }, origin: "renderer" },
      { msg: { version: V, error: { code: "VALIDATION_FAILED", surfaceId: "s1", path: "/components/0/component", message: "Not in the catalog" } }, origin: "renderer" },
      { msg: "nope", origin: "llm" },
    ]);
    expect(lines.map((l) => [l.kind, l.text])).toEqual([
      ["action", '↑ pick_flight(id="r1", carrier="Lufthansa")'],
      ["error", "✕ /components/0/component · Not in the catalog"],
      ["invalid", "invalid message"],
    ]);
  });
});

describe("pairFetches", () => {
  test("pairs in order by record count and never pairs one write twice", () => {
    const msgs = [dataModel("/a", [1, 2], "data"), dataModel("/b", [1], "data"), dataModel("/a", [1, 2], "data")];
    const { paired, unpaired } = pairFetches(msgs, [fetchOk("a", 2), fetchOk("b", 1)]);
    expect([...paired.entries()].map(([i, f]) => [i, f.query])).toEqual([
      [0, "a"],
      [1, "b"],
    ]);
    expect(unpaired).toEqual([]);
  });
});

describe("JSON tab rows", () => {
  test("a header per message, then its pretty lines numbered over the whole turn", () => {
    const rows = prettyRows([
      { msg: { version: V, deleteSurface: { surfaceId: "s1" } }, origin: "llm" },
      { msg: { version: V, updateDataModel: { surfaceId: "s1", path: "/a", value: 1 } }, origin: "knob" },
    ]);
    const heads = rows.filter((r) => r.kind === "head");
    expect(heads.map((h) => (h.kind === "head" ? [h.label, h.origin] : null))).toEqual([
      ["deleteSurface", "llm"],
      ["updateDataModel", "knob"],
    ]);
    const lines = rows.filter((r) => r.kind === "line");
    expect(lines.map((r) => (r.kind === "line" ? r.n : 0))).toEqual(lines.map((_, i) => i + 1));
    expect(lines[0].kind === "line" && lines[0].text).toBe("{");
    expect(messageName(42)).toBe("invalid");
  });

  test("JSON lines split into keys, strings, bindings, numbers and literals", () => {
    expect(jsonTokens('  "value": {"@path": "/a"}, "n": -1.5, "ok": true').map((x) => [x.k, x.v])).toEqual([
      ["op", "  "],
      ["key", '"value"'],
      ["punct", ":"],
      ["op", " "],
      ["punct", "{"],
      ["key", '"@path"'],
      ["punct", ":"],
      ["op", " "],
      ["str", '"/a"'],
      ["punct", "}"],
      ["punct", ","],
      ["op", " "],
      ["key", '"n"'],
      ["punct", ":"],
      ["op", " "],
      ["num", "-1.5"],
      ["punct", ","],
      ["op", " "],
      ["key", '"ok"'],
      ["punct", ":"],
      ["op", " "],
      ["lit", "true"],
    ]);
    expect(jsonTokens('"say \\"hi\\""').map((x) => x.k)).toEqual(["str"]);
  });
});

describe("payloadSizes", () => {
  test("counts the compact JSON of the agent's messages against the compact lines", () => {
    const msgs: TurnMessage[] = [
      comps([
        { id: "root", component: "Card", child: "main" },
        { id: "main", component: "Column", children: ["t"] },
      ]),
      { msg: { version: V, error: { path: "/x", message: "m" } }, origin: "renderer" },
    ];
    const lines = compactLines(msgs);
    const p = payloadSizes(msgs, lines);
    expect(p.messages).toBe(1);
    expect(p.json).toBe(JSON.stringify(msgs[0].msg).length + 1);
    expect(p.compact).toBe("root = Card(main)".length + 1 + "main = Column([t])".length + 1);
    expect(p.ratio).toBeCloseTo(p.json / p.compact, 5);
  });

  test("no messages: no ratio", () => {
    expect(payloadSizes([], [])).toEqual({ json: 0, compact: 0, ratio: null, messages: 0 });
  });
});
