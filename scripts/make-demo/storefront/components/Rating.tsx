'use client';

export default function Rating({ value }: { value: number }) {
  return <span aria-label={`${value} out of 5`}>{'★'.repeat(Math.round(value))}</span>;
}
