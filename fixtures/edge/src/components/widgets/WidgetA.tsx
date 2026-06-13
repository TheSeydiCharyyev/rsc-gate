'use client';

import { useEffect, useState } from 'react';

export function WidgetA({ id }: { id: string }) {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    setData(`live:${id}`);
  }, [id]);
  return <div>{data}</div>;
}
