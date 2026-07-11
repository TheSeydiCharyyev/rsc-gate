import * as UI from '../ui';

export default function Page() {
  return (
    <main>
      {/* A namespaced tag: the tag name is a property access, not an identifier,
          so it matched nothing and this hazard was invisible. */}
      <UI.Button onClick={() => {}} />

      {/* Negative: a server component behind the same namespace. */}
      <UI.ServerCard render={() => 'x'} />
    </main>
  );
}
