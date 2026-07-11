// A JS Next project: aliases live in jsconfig.json, not tsconfig.json. Reading
// only tsconfig meant every alias here was dropped and the report came back
// empty — the leak below was invisible.
import { Leaky } from '@/components/Leaky';
import { Plain } from '@/components/Plain';

export default function Page() {
  return (
    <main>
      <Leaky />
      <Plain onPick={() => {}} />
    </main>
  );
}
