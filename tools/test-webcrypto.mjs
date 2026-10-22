import {webcrypto} from 'node:crypto';

// Node 18 does not expose Web Crypto globally by default. Match Node 22 and
// modern secure browser contexts without adding Node imports to browser code.
export function installWebCrypto(target=globalThis) {
  if (!target.crypto) target.crypto=webcrypto;
}

installWebCrypto();
