import 'server-only';

// Wholesale margin. This module is not supposed to reach a browser.
export const MARGIN = 0.42;

export function priceHistory(sku: string): number[] {
  const seed = sku.length * 7;
  return [seed + 180, seed + 220, seed + 140, seed + 260, seed + 200];
}

export function wholesale(cents: number): number {
  return Math.round(cents * (1 - MARGIN));
}
