import { WidgetA } from '@/components/widgets';

export default function DashboardPage({ params }: { params: { id: string } }) {
  return <WidgetA id={params.id} />;
}
