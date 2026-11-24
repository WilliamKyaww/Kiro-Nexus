// Build the service bundle once so integration tests run the real process.
export default async function setup(): Promise<void> {
  // @ts-expect-error plain ESM helper without types
  const { buildServer } = await import("../../scripts/bundles.mjs");
  await buildServer();
}
