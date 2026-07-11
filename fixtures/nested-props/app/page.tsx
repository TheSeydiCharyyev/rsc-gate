import { Client } from '../components/Client';
import { Icon } from '../components/Icon';
import { arrow, config, helper, label } from '../lib/helpers';
import { save } from '../lib/actions';

declare const cond: boolean;
declare function makeHandler(): () => void;

export default function Page() {
  return (
    <main>
      {/* HAZARDS — each one breaks next build at prerender */}
      <Client importedFn={helper} />
      <Client importedArrow={arrow} />
      <Client inObject={{ onPick: () => {} }} />
      <Client inArray={[() => {}]} />
      <Client inTernary={cond ? () => {} : undefined} />
      <Client deepNested={{ a: { b: [{ cb: () => {} }] } }} />
      <Client methodShorthand={{ onPick() {} }} />
      <Client viaOr={undefined ?? (() => {})} />
      <Client nestedClassInstance={{ when: new WeakMap() }} />

      {/* LEGAL — flagging any of these would be a false positive */}
      <Client action={save} />
      <Client actionInObject={{ onSave: save }} />
      <Client plainObject={config} />
      <Client plainString={label} />
      <Client clientRef={Icon} />
      <Client fromCall={makeHandler()} />
      <Client serializable={{ when: new Date(), items: [1, 2] }} />
    </main>
  );
}
