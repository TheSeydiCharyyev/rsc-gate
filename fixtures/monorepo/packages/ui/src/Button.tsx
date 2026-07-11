'use client';

// A client component shared through a workspace package. Without the exports map
// the package resolved to nothing, so this component — and the leak below — were
// invisible to the whole analysis.
import 'server-only';

export function Button({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} />;
}
