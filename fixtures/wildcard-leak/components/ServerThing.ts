import 'server-only';

// Shares the barrel with Helper but is never imported by client code — must stay server,
// with NO fake server-only violation.
export function ServerThing(): string {
  return 's';
}
