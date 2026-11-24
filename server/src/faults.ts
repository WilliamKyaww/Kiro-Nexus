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

// NEXUS_FAULT_THROW ("point" or "point:n") makes the n-th hit throw instead of
// exiting, simulating an ordinary I/O failure (disk full, file locked) in a real process.
const throwFault = process.env.NEXUS_FAULT_THROW;
if (throwFault && !injector) {
  const m = throwFault.match(/^(.*?)(?::(\d+))?$/);
  const target = m?.[1] ?? throwFault;
  const nth = Number(m?.[2] ?? 1);
  let hits = 0;
  injector = (point) => {
    if (point !== target) return;
    hits += 1;
    if (hits === nth) throw new Error(`Simulated write failure at ${point}`);
  };
}

// NEXUS_FAULT_DELAY ("point:ms") pauses every hit of one point, to widen a race window in a test.
const delayFault = process.env.NEXUS_FAULT_DELAY?.match(/^(.*):(\d+)$/) ?? null;

export async function faultDelay(point: string): Promise<void> {
  if (delayFault && delayFault[1] === point) await new Promise((r) => setTimeout(r, Number(delayFault[2])));
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
