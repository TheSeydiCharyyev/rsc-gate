// Plain functions. Passing one to a client component is the same hazard as an
// inline arrow — it was invisible because only functions declared in the calling
// file were tracked.
export function helper() {
  return 1;
}
export const arrow = () => 2;

// NOT functions — these must stay `ok`, or the fix is a false-positive machine.
export const config = { retries: 3 };
export const label = 'hi';
