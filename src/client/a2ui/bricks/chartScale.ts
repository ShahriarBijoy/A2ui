/**
 * One scale for a chart's axis: a round top above the largest value and evenly spaced ticks from 0, so the axis
 * labels read as round numbers. Shared by every chart type (bars today; an area chart draws its y labels from it).
 */
export type ChartScale = { max: number; ticks: number[] };

const STEPS = [1, 2, 2.5, 5, 10];

/** Ticks 0..max in `intervals` equal steps of 1, 2, 2.5 or 5 × a power of ten; nothing positive → [0]. */
export function niceScale(values: readonly number[], intervals = 4): ChartScale {
  const top = Math.max(0, ...values.map((v) => (Number.isFinite(v) ? v : 0)));
  if (top <= 0 || intervals < 1) return { max: 0, ticks: [0] };
  const rough = top / intervals;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = (STEPS.map((s) => s * pow).find((s) => s * intervals >= top - 1e-9) ?? 10 * pow);
  // Rounded to the step's precision, so 0.1 × 3 prints as 0.3, not 0.30000000000000004.
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const ticks = Array.from({ length: intervals + 1 }, (_, i) => Number((step * i).toFixed(digits)));
  return { max: ticks[ticks.length - 1], ticks };
}

/** A value's position on the scale in percent, clamped to 0..100. */
export function scalePct(value: number, scale: ChartScale): number {
  if (!(scale.max > 0) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, (value / scale.max) * 100));
}
