'use client';

export function Button({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} />;
}
