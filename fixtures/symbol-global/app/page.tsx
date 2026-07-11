import { Chart } from '../components/Chart';

// A healthy project. Flight accepts a symbol from the global registry: it names the
// symbol by its key and re-derives it on the client (`Symbol.for(name) !== value` is
// the only thing it throws on). Nothing here may fail --strict — this fixture exists
// to prove the gate stays quiet, the assertion 0.2.0 did not have.
export default function Page() {
  return <Chart kind={Symbol.for('chart')} label="Q3" />;
}
