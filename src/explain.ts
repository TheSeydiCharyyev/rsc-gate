export interface Explanation {
  /** Short kebab-case slug. */
  code: string;
  title: string;
  /** How the error surfaces — quote of the React/Next message. */
  symptom: string;
  /** Why it happens. */
  cause: string;
  /** How to fix it. */
  fix: string;
  /** Optional canonical docs URL. Left empty when no stable URL is known. */
  docs?: string;
}

export const EXPLANATIONS: Explanation[] = [
  {
    code: 'function-props',
    title: 'Functions passed to a Client Component',
    symptom: '"Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with \\"use server\\"."',
    cause:
      'Props sent from a Server Component to a Client Component must be serializable so they can be sent over the network. Plain functions are not serializable, so React rejects them during render/prerender.',
    fix: 'Pass a Server Action (a function in a "use server" module or file) instead, or move the handler into the Client Component itself and keep the data props plain.',
    docs: 'https://react.dev/reference/rsc/use-client',
  },
  {
    code: 'event-handlers',
    title: 'Event handlers passed to a Client Component',
    symptom: '"Event handlers cannot be passed to Client Component props."',
    cause:
      'A Server Component rendered a Client Component and gave it an event handler such as onClick={...}. Handlers are functions, which cannot cross the server→client boundary, so prerendering fails.',
    fix: 'Define the handler inside the Client Component (mark that component with "use client" and attach the handler there), or pass a Server Action for form submissions via the action prop.',
    docs: 'https://react.dev/reference/rsc/use-client',
  },
  {
    code: 'context-in-server',
    title: 'React Context used in a Server Component',
    symptom: 'createContext / useContext throws or returns nothing when used in a Server Component (e.g. "createContext only works in Client Components").',
    cause:
      'React Context relies on client-side rendering state and is not available in the Server Component tree. Server Components render once on the server and have no client context.',
    fix: 'Create the provider in a module marked "use client" and render it as high in the tree as needed; consume the context only from Client Components. Server Components should receive data via props or fetch it directly.',
    docs: 'https://react.dev/reference/rsc/use-client',
  },
  {
    code: 'class-instance-prop',
    title: 'A class instance passed across the boundary',
    symptom: 'Serialization error when a class instance (e.g. a model, a Date subclass, an ORM entity) is passed as a prop to a Client Component.',
    cause:
      'Only plain data survives serialization across the server→client boundary. Class instances lose their prototype and methods, so React refuses to serialize them.',
    fix: 'Convert the instance to a plain object (a POJO) before passing it — e.g. map the entity to a plain record with just the fields the client needs.',
  },
  {
    code: 'client-importing-server',
    title: 'A Client Component imports server-only code',
    symptom: '"You\'re importing a component that needs server-only. That only works in a Server Component..." (or a runtime crash pulling server code into the browser bundle).',
    cause:
      'A module marked "use client" (or reachable from one) imported the "server-only" package or server-only code. That code would be shipped to the browser, which the server-only guard prevents.',
    fix: 'Keep server-only modules out of the client import graph: fetch data in a Server Component and pass plain props down, or split the file so the client part imports only client-safe code.',
  },
  {
    code: 'use-client-needed',
    title: 'Browser-only hooks/APIs without "use client"',
    symptom: '"useState"/"useEffect" "only works in a Client Component" or "window/document is not defined" during server rendering.',
    cause:
      'Hooks like useState/useEffect and browser APIs (window, document, localStorage) only exist on the client, but the module is being treated as a Server Component (the default in the App Router).',
    fix: 'Add the "use client" directive at the top of the file, or move the interactive logic into a dedicated Client Component and keep the rest on the server.',
    docs: 'https://react.dev/reference/rsc/use-client',
  },
];

export function findExplanation(query: string): Explanation | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const byCode = EXPLANATIONS.find((e) => e.code === q);
  if (byCode) return byCode;
  return EXPLANATIONS.find((e) => e.symptom.toLowerCase().includes(q)) ?? null;
}
