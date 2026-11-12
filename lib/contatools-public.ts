import publicConfig from "../desktop/shared-access/public-config.json";

// Explicit owner-approved additive trust. Original offline keys remain unchanged.
export const SERVICE_LICENSE_KEYS:Record<string,JsonWebKey>=Object.fromEntries(
  Object.entries(publicConfig.issuers).map(([kid,key])=>[`contatools-online-v2:${kid}`,key]),
);
