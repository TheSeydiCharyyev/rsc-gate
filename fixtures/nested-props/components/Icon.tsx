'use client';

// A client component passed as a prop is a client *reference*, which React does
// serialize. It must not be mistaken for a plain function.
export function Icon() {
  return <span>icon</span>;
}
