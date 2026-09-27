/**
 * Flags percentages in the explanation that don't match any number we supplied.
 * Cheap guard against the model inventing frequencies.
 */
export function findUngroundedPercentages(text: string, allowedPercents: number[], tolerance = 1.5): string[] {
  const allowed = [0, 100, ...allowedPercents];
  const out: string[] = [];
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
    const value = Number(m[1]);
    if (!allowed.some((a) => Math.abs(a - value) <= tolerance)) out.push(m[0].replace(/\s+/g, ''));
  }
  return [...new Set(out)];
}
