import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Egress policy for webhook destinations (F17). A subscriber-supplied URL must
 * not reach loopback, private, link-local (cloud metadata), carrier-grade NAT,
 * multicast or other reserved ranges. The host is resolved and every address
 * checked at registration *and* immediately before each send; the request is
 * then pinned to the checked address so a DNS change between check and
 * connect (rebinding) cannot redirect it.
 */
// Separate lists: Node matches IPv4 lookups against IPv4-mapped IPv6 rules.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blockedV4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blockedV6.addSubnet(network, prefix, 'ipv6');
}

/** True when an IP address literal is not a public unicast address. */
export const isBlockedAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return blockedV4.check(address, 'ipv4');
  // Includes every IPv4-mapped form (::ffff:0:0/96): a public webhook host has
  // no reason to answer with one, so they are refused outright.
  if (family === 6) return blockedV6.check(address, 'ipv6');
  return true;
};

export interface ResolvedDestination {
  url: URL;
  address: string;
  family: 4 | 6;
}

export type DestinationProblem = 'invalid_url' | 'dns_failed' | 'destination_blocked';

export class DestinationError extends Error {
  constructor(readonly code: DestinationProblem) {
    super(code);
    this.name = 'DestinationError';
  }
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: Resolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Resolves a webhook URL to one checked address. Every resolved address must
 * be public (a mixed answer is refused). `allowPrivate` is for local
 * development only.
 */
export const resolveDestination = async (
  raw: string,
  { allowPrivate = false, resolver = defaultResolver }: { allowPrivate?: boolean; resolver?: Resolver } = {},
): Promise<ResolvedDestination> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DestinationError('invalid_url');
  }
  if ((url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) || url.username || url.password) {
    throw new DestinationError('invalid_url');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: Array<{ address: string; family: number }>;
  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addresses = await resolver(host);
    } catch {
      throw new DestinationError('dns_failed');
    }
  }
  if (!allowPrivate && addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw new DestinationError('destination_blocked');
  }
  const [first] = addresses;
  if (!first) throw new DestinationError('dns_failed');
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
};
