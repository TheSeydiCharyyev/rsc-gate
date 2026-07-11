// No "use client": nothing crosses a boundary here, so <UI.ServerCard render={fn}>
// must NOT be flagged — the tag being namespaced changes nothing about that.
export function ServerCard({ render }: { render: () => string }) {
  return <div>{render()}</div>;
}
