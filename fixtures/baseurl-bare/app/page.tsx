// Bare specifiers, resolved against baseUrl — no "./" and no alias prefix.
import { Leaky } from 'components/Leaky';
import { Plain } from 'components/Plain';

// Negatives, all reachable so a regression surfaces here:
//   'react'      — a real package: nothing exists under baseUrl, stays external
//   'dead/Ghost' — a paths pattern with a dead target. ./dead/Ghost.tsx EXISTS,
//                  but a matched pattern is final: tsc does NOT fall back to
//                  baseUrl, and neither may we, or Ghost's leak would appear.
import type { ReactNode } from 'react';
import { Ghost } from 'dead/Ghost';

export default function Page(): ReactNode {
  return (
    <main>
      <Leaky />
      <Plain />
      <Ghost />
    </main>
  );
}
