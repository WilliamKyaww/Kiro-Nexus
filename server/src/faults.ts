// Fault injection for crash and recovery tests. Inert unless a test or
// NEXUS_FAULT (format "point" or "point:n", the n-th hit) enables it.
// When triggered through the environment variable, the process exits
// immediately with code 86, simulating a crash with no clean-up.

type Injector = (point: string) => void;
let injector: Injector | null = null;

const envFault = process.env.NEXUS_FAULT;
if (envFault) {
  // Point names contain colons ("review:after-file-write"); an optional trailing ":<n>" is the hit count.
  const m = envFault.match(/^(.*?)(?::(\d+))?$/);
  const target = m?.[1] ?? envFault;
  const nth = Number(m?.[2] ?? 1);
  let hits = 0;
  injector = (point) => {
    if (point !== target) return;
    hits += 1;
    if (hits >= nth) process.exit(86);
  };
}

export function setFaultInjector(fn: Injector | null): void {
  injector = fn;
}

export function faultPoint(point: string): void {
  injector?.(point);
}

export class InjectedFault extends Error {
  constructor(readonly point: string) {
    super(`Injected fault at ${point}`);
  }
}
