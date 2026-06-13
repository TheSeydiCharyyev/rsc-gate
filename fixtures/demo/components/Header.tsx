import { Card } from './ui';

export function Header({ title }: { title: string }) {
  return (
    <Card>
      <h1>{title}</h1>
    </Card>
  );
}
