'use client';

import { useState } from 'react';

export default function Chart({ onSave, title }: { onSave: (data: FormData) => Promise<void>; title: string }) {
  const [zoom, setZoom] = useState(1);
  return (
    <figure onClick={() => setZoom(zoom + 1)}>
      {title} @ {zoom}x
      <form action={onSave}>
        <button type="submit">Save</button>
      </form>
    </figure>
  );
}
