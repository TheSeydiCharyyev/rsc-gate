import Chart from '@/components/Chart';
import { WidgetB } from '@/components/widgets';
import { saveLead } from '@/lib/actions';

export default function MarketingPage() {
  return (
    <section>
      <WidgetB label="Static stats" />
      {/* Server Action passed to a client component — legal, must NOT be flagged */}
      <Chart onSave={saveLead} title="Conversions" />
    </section>
  );
}
