/* A software WebAuthn authenticator for tests: a P-256 key that makes "none" attestations and
   assertions the way a browser's would, for any relying-party id and origin. */
import crypto from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');
const sha = b => crypto.createHash('sha256').update(b).digest();
const cborHead = (major, n) => n < 24 ? Buffer.from([(major << 5) | n])
  : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
const cborText = s => Buffer.concat([cborHead(3, Buffer.byteLength(s)), Buffer.from(s)]);
const cborBytes = b => Buffer.concat([cborHead(2, b.length), b]);

export function softPasskey({ rpId, origin }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), Buffer.from(jwk.x, 'base64url'),
    Buffer.from([0x22, 0x58, 0x20]), Buffer.from(jwk.y, 'base64url'),
  ]);
  const raw = crypto.randomBytes(16);
  const id = b64u(raw);
  let counter = 0;
  return {
    id,
    attestation(challenge, { o = origin, rp = rpId } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: o, crossOrigin: false }));
      const len = Buffer.from([raw.length >> 8, raw.length & 255]);
      const authData = Buffer.concat([sha(rp), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, raw, cose]);
      const attestationObject = Buffer.concat([
        Buffer.from([0xa3]), cborText('fmt'), cborText('none'), cborText('attStmt'), Buffer.from([0xa0]),
        cborText('authData'), cborBytes(authData),
      ]);
      return {
        id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] },
      };
    },
    assertion(challenge, { o = origin, rp = rpId, badSignature = false } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: o, crossOrigin: false }));
      const c = Buffer.alloc(4); c.writeUInt32BE(++counter);
      const authData = Buffer.concat([sha(rp), Buffer.from([0x05]), c]);
      const signature = crypto.sign('sha256', Buffer.concat([authData, sha(clientDataJSON)]), privateKey);
      if (badSignature) signature[signature.length - 1] ^= 0xff;
      return {
        id, rawId: id, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
        response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: null },
      };
    },
  };
}
