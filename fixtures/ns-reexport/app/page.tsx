import { widgets } from '../components/barrel';

export default function Page() {
  // A namespaced tag. The tag name is a property access, not an identifier, so it
  // used to match nothing: the boundary was found, but the props were never
  // checked. Both hazards below were invisible.
  return <widgets.Widget onPick={() => {}} thing={new WeakMap()} />;
}
