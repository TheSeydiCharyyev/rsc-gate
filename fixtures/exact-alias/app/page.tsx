import { Leaky } from '@/leaky';
import { helper } from '@/lib';
import { thing } from 'untyped-pkg';
import { ghost } from '@/ghost';

export default function Page() {
  return <Leaky label={helper() + thing() + String(ghost)} />;
}
