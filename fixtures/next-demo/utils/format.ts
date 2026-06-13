// Server-safe pure util — ends up in the CLIENT bundle only because ProductList ("use client") imports it.
export function formatPrice(value: number): string {
  return `$${value.toFixed(2)}`;
}
