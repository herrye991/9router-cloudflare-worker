// Empty stub for Node builtins / packages that the open-sse engine imports but that
// are never exercised in the Workers runtime (e.g. node:child_process, node:readline,
// node:fs in CLI-spawning executors; undici / got-scraping in the proxy-fetch path).
// Bundling them to this no-op lets esbuild build the edge bundle; the stubbed code
// paths simply throw if ever called at the edge (they are not, for fetch-based
// providers). See cloud/build.mjs.
export default {};
export const spawn = undefined;
export const spawnSync = undefined;
export const execFile = undefined;
export const readFileSync = undefined;
export const writeFileSync = undefined;
export const existsSync = undefined;
export const createReadStream = undefined;
export function createInterface() {
  throw new Error("node:readline is not available in the Workers runtime");
}
