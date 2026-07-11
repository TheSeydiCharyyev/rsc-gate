export class Money {
  constructor(readonly cents: number) {}

  plus(other: Money): Money {
    return new Money(this.cents + other.cents);
  }

  toString(): string {
    return `$${(this.cents / 100).toFixed(2)}`;
  }
}
