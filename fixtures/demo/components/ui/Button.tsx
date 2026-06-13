'use client';

export function Button({ onClick, children }: { onClick: () => void; children: any }) {
  return (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );
}
