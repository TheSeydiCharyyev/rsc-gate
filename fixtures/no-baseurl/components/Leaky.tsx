'use client';
import 'server-only';

export function Leaky() {
  return <div>not reachable without baseUrl</div>;
}
