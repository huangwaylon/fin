// SSRF guard for the article-extraction endpoint, which fetches user-supplied
// URLs server-side. A string match on the hostname is NOT enough: a public
// hostname can resolve to a private/loopback address (DNS rebinding), and IPs
// can be written in decimal/hex/IPv6 forms that a naive regex misses. So we
// resolve the host and classify the actual address(es) it points at.
//
// Residual risk (accepted): the address we validate and the address Node's fetch
// later connects to are resolved separately, so a DNS-rebinding server with a
// near-zero TTL can still win the race (TOCTOU). True fix is pinning the socket
// to the validated IP, which needs a custom dispatcher (a dependency) — out of
// scope for this dependency-free server. The per-hop re-validation in news.js
// (redirect: 'manual') shrinks, but does not close, this window.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Expand an IPv6 string (handling '::' compression) into 8 16-bit hextets.
// Returns null if the string isn't a parseable hextet form.
function hextets(a) {
  if (a.includes('.')) return null; // has embedded IPv4 — handled by the caller
  const parts = a.includes('::')
    ? (() => {
        const [h, t] = a.split('::');
        const head = h ? h.split(':').filter(Boolean) : [];
        const tail = t ? t.split(':').filter(Boolean) : [];
        const fill = 8 - head.length - tail.length;
        if (fill < 0) return null;
        return [...head, ...Array(fill).fill('0'), ...tail];
      })()
    : a.split(':');
  if (!parts || parts.length !== 8) return null;
  return parts.map((x) => parseInt(x || '0', 16) & 0xffff);
}

const v4FromBytes = (a, b) => `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`;

// True for any non-public address: loopback, RFC1918 private, link-local, CGNAT,
// multicast/broadcast, and the IPv6 equivalents (loopback/ULA/link-local), plus
// IPv4 embedded in IPv6 (mapped, 6to4) classified by the embedded v4.
export function isPrivateIp(ip) {
  if (isIP(ip) === 4) {
    const o = ip.split('.').map(Number);
    if (o[0] === 0 || o[0] === 127 || o[0] === 10) return true; // this-host, loopback, private
    if (o[0] === 192 && o[1] === 168) return true; // private
    if (o[0] === 169 && o[1] === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // private
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT
    if (o[0] >= 224) return true; // multicast (224/4), reserved (240/4), broadcast (255.255.255.255)
    return false;
  }
  const a = ip.toLowerCase();
  // Any embedded dotted-quad (IPv4-mapped ::ffff:127.0.0.1) -> classify the v4.
  const dotted = a.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return isPrivateIp(dotted[1]);

  const h = hextets(a);
  if (!h) return true; // unparseable -> refuse (fail closed)
  // IPv4-mapped in hex form (::ffff:7f00:1) -> classify the embedded v4.
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff)
    return isPrivateIp(v4FromBytes(h[6], h[7]));
  // 6to4 (2002::/16) embeds the v4 in the next two hextets -> classify it.
  if (h[0] === 0x2002) return isPrivateIp(v4FromBytes(h[1], h[2]));
  // Default-deny: allow only global-unicast 2000::/3. Everything else (::1, ::,
  // fc00::/7 ULA, fe80::/10 link-local, ff00::/8 multicast, 64:ff9b::/96 NAT64)
  // falls outside and is refused.
  return !(h[0] >= 0x2000 && h[0] <= 0x3fff);
}

// Throws an http-style error ({ status }) if the URL is non-http(s), unresolvable,
// or resolves to any private/loopback address. `resolve` is injectable for tests.
export async function assertPublicUrl(u, resolve = (h) => lookup(h, { all: true })) {
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    throw httpError(400, 'Invalid url');
  }
  if (!/^https?:$/.test(parsed.protocol)) throw httpError(400, 'Only http(s) URLs allowed');

  // The WHATWG URL parser normalizes IPv4 literals in any base (decimal
  // 2130706433, hex 0x7f.0.0.1, etc.) into dotted-quad hostnames, so a literal
  // private IP in an exotic encoding is already caught when we resolve it.
  let addrs;
  try {
    addrs = await resolve(parsed.hostname);
  } catch {
    throw httpError(400, 'Cannot resolve host');
  }
  if (!addrs || !addrs.length) throw httpError(400, 'Cannot resolve host');
  for (const { address } of addrs) {
    if (isPrivateIp(address)) throw httpError(403, 'Refusing to fetch a private address');
  }
}
