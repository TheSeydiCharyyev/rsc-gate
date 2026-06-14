'use client';

export function Form({ onSave }: { onSave: () => void }) {
  return <button onClick={onSave}>save</button>;
}
