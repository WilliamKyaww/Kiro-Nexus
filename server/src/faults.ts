// Fault injection for crash and recovery tests. Inert unless a test or
// NEXUS_FAULT (format "point" or "point:n", the n-th hit) enables it.
// When triggered through the environment variable, the process exits
// immediately with code 86, simulating a crash with no clean-up.

type Injector = (point: string) => void;
let injector: Injector | null = null;

const envFault = process.env.NEXUS_FAULT;
if (envFault) {
  const [target, nth] = envFault.split(":");
  let hits = 0;
  injector = (point) => {
    if (point !== target) return;
    hits += 1;
    if (hits >= Number(nth ?? 1)) process.exit(86);
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
