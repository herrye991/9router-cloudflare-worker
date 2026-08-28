import dns from "dns";

// Force public DNS to bypass OS negative cache (mDNSResponder holds NXDOMAIN).
// Guarded with try/catch: in the Cloudflare Workers runtime (OpenNext edge build)
// `dns.promises.Resolver.setServers` is not implemented and throws at module
// load time. The tunnel features that use this resolver are Node-only anyway.
const resolver = new dns.promises.Resolver();
try {
  resolver.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);
} catch {
  // Workers / non-Node runtimes — resolver stays default (unconfigured).
}

// Try custom public DNS first, fall back to OS resolver
// (Cloudflare DNS may not resolve all hostnames, e.g. *.ts.net)
export async function resolveDns(hostname, timeoutMs) {
  const tryResolver = (fn) => Promise.race([
    fn(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("dns timeout")), timeoutMs)),
  ]).then(() => true).catch(() => false);

  if (await tryResolver(() => resolver.resolve4(hostname))) return true;
  return tryResolver(() => dns.promises.resolve4(hostname));
}
