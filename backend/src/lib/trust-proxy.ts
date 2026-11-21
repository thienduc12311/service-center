/** Express `trust proxy` setting: off, a number of hops, or a list of trusted addresses. */
export type TrustProxySetting = false | number | string;

const HOPS = /^\d+$/;
const NAMED_SUBNET = /^(loopback|linklocal|uniquelocal)$/i;
const ADDRESS = /^[0-9a-f:.]+(\/\d{1,3})?$/i;

/**
 * Parses the TRUST_PROXY env value. Unset or "false" trusts no proxy, so a
 * client reaching the API directly cannot choose its own address with
 * X-Forwarded-For. An integer is the number of proxy hops in front of the API;
 * otherwise a comma-separated list of subnet names or addresses/CIDRs.
 * "true" (trust every hop) is refused: it lets any client spoof its address.
 */
export const parseTrustProxy = (raw: string | undefined): TrustProxySetting => {
  const value = (raw ?? '').trim();
  if (value === '' || value.toLowerCase() === 'false') return false;
  if (HOPS.test(value)) {
    const hops = Number(value);
    return hops === 0 ? false : hops;
  }
  const parts = value.split(',').map((part) => part.trim());
  if (parts.every((part) => NAMED_SUBNET.test(part) || ADDRESS.test(part))) {
    return parts.join(',');
  }
  throw new Error('TRUST_PROXY must be "false", a hop count such as "1", or a comma-separated list of proxy addresses/CIDRs');
};
