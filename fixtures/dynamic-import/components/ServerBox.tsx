// NO "use client": a server component, lazily loaded. Nothing crosses a boundary
// here, so its props must NOT be flagged — a lazy import is not a boundary by
// itself, and saying otherwise would be a false positive.
export default function ServerBox({ render }: { render: () => string }) {
  return <div>{render()}</div>;
}
