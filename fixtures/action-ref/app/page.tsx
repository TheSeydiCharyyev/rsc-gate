import { Form } from '../components/Form';

// Module-scope Server Action — a legal prop to a client component (regression for FP #1).
const save = () => {
  'use server';
  console.log('saved');
};

export default function Page() {
  return <Form onSave={save} />;
}
