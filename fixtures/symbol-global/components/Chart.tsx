'use client';

export function Chart({ kind, label }: { kind: symbol; label: string }) {
  return <figure data-kind={String(kind)}>{label}</figure>;
}
