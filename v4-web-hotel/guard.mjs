// Public mode: refuse addresses inside private networks, so a shared copy of the tool can't be used to
// reach the host's own machine or office network.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE = [/^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^::1?$/, /^f[cd]/i, /^fe80/i];

// shortcut: checks DNS before each fetch, so a host that changes its answer in between (DNS rebinding) slips through; put an egress proxy in front if this goes on the open internet.
export async function guard(url) {
	const { protocol, hostname } = new URL(url);
	if (!/^https?:$/.test(protocol)) throw new Error('only http and https addresses are allowed');
	const host = hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
	if (addresses.map(toV4).some((a) => PRIVATE.some((re) => re.test(a)))) throw new Error('that address is inside a private network, which public mode blocks');
}

// IPv4 written inside IPv6 (::ffff:127.0.0.1, which URL parsing turns into ::ffff:7f00:1) is checked as plain IPv4.
function toV4(address) {
	const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
	if (hex) return [hex[1], hex[2]].flatMap((h) => { const n = parseInt(h, 16); return [n >> 8, n & 255]; }).join('.');
	return address.replace(/^::ffff:/i, '');
}
