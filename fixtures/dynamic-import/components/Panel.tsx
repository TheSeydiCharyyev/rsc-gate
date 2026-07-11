'use client';

// Loaded through React.lazy — the same boundary as next/dynamic.
export default function Panel({ onClose }: { onClose: () => void }) {
  return <button onClick={onClose}>close</button>;
}
