import { ok, fail, computed } from '../src/contracts.js';

const b64urlToJson = (part) => {
  const padded = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
};

const asIso = (v) => (typeof v === 'number' && Number.isFinite(v) ? new Date(v * 1000).toISOString().replace('.000Z', 'Z') : null);

export default {
  name: 'jwtDecode',
  description: 'Decode the header and claims inside a JSON Web Token.',
  category: 'developer', tier: 'standard',
  title: 'Decode a JWT',
  unbuilt: false, needsNetwork: false, dataAsOf: null,
  /* Reading a JWT and trusting a JWT are different things and this only does
     the first. Verifying the signature needs the issuer's key, which Pigeon
     does not have and could not fetch offline. */
  labels: ['unverified'],
  replyTemplate: 'Algorithm {{algorithm}}, {{claimCount}} {{claimCount|plural:claim:claims}}. The signature is NOT checked — this shows what the token says, not whether it is genuine.\n{{payloadJson}}',
  inputSchema: {
    type: 'object', required: ['token'],
    properties: { token: { type: 'string', label: 'token', minLength: 1, prompt: 'Which JWT should I decode?' } }
  },
  outputSchema: {
    type: 'object',
    properties: {
      header: { type: 'object' }, payload: { type: 'object' },
      headerJson: { type: 'string' }, payloadJson: { type: 'string' },
      algorithm: { type: 'string' }, claimCount: { type: 'integer' },
      expiresAt: { type: 'string' }, issuedAt: { type: 'string' }, signaturePresent: { type: 'boolean' }
    }
  },
  examples: [
    { text: 'decode this jwt', input: { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFuYSIsImlhdCI6MTUxNjIzOTAyMn0.c2lnbmF0dXJl' }, output: { header: { alg: 'HS256', typ: 'JWT' }, payload: { sub: '1234567890', name: 'Ana', iat: 1516239022 }, headerJson: '{\n  "alg": "HS256",\n  "typ": "JWT"\n}', payloadJson: '{\n  "sub": "1234567890",\n  "name": "Ana",\n  "iat": 1516239022\n}', algorithm: 'HS256', claimCount: 3, expiresAt: null, issuedAt: '2018-01-18T01:30:22Z', signaturePresent: true } },
    { text: 'what is inside this token', input: { token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImsxIn0.eyJpc3MiOiJodHRwczovL2V4YW1wbGUuY29tIiwiZXhwIjoxODkzNDU2MDAwLCJzdWIiOiJ1c2VyLTcifQ.c2lnbmF0dXJl' }, output: { header: { alg: 'RS256', typ: 'JWT', kid: 'k1' }, payload: { iss: 'https://example.com', exp: 1893456000, sub: 'user-7' }, headerJson: '{\n  "alg": "RS256",\n  "typ": "JWT",\n  "kid": "k1"\n}', payloadJson: '{\n  "iss": "https://example.com",\n  "exp": 1893456000,\n  "sub": "user-7"\n}', algorithm: 'RS256', claimCount: 3, expiresAt: '2030-01-01T00:00:00Z', issuedAt: null, signaturePresent: true } },
    { text: 'read the claims in this jwt', input: { token: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJoZWxsbyI6IndvcmxkIn0.c2lnbmF0dXJl' }, output: { header: { alg: 'none', typ: 'JWT' }, payload: { hello: 'world' }, headerJson: '{\n  "alg": "none",\n  "typ": "JWT"\n}', payloadJson: '{\n  "hello": "world"\n}', algorithm: 'none', claimCount: 1, expiresAt: null, issuedAt: null, signaturePresent: true } },
    { text: 'decode a token with an expiry', input: { token: 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTcwMDAwMzYwMH0.c2lnbmF0dXJl' }, output: { header: { alg: 'HS512', typ: 'JWT' }, payload: { role: 'admin', iat: 1700000000, exp: 1700003600 }, headerJson: '{\n  "alg": "HS512",\n  "typ": "JWT"\n}', payloadJson: '{\n  "role": "admin",\n  "iat": 1700000000,\n  "exp": 1700003600\n}', algorithm: 'HS512', claimCount: 3, expiresAt: '2023-11-14T23:13:20Z', issuedAt: '2023-11-14T22:13:20Z', signaturePresent: true } },
    { text: 'decode a jwt that has no signature part', input: { token: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJoZWxsbyI6IndvcmxkIn0.' }, output: { header: { alg: 'none', typ: 'JWT' }, payload: { hello: 'world' }, headerJson: '{\n  "alg": "none",\n  "typ": "JWT"\n}', payloadJson: '{\n  "hello": "world"\n}', algorithm: 'none', claimCount: 1, expiresAt: null, issuedAt: null, signaturePresent: false } }
  ],
  errorCases: [
    { input: { token: 'not.a.jwt' }, code: 'INVALID_INPUT' },
    { input: { token: 'onlyonepart' }, code: 'INVALID_INPUT' },
    { input: { token: 'eyJhbGciOiJIUzI1NiJ9.bm90anNvbg.sig' }, code: 'INVALID_INPUT' },
    { input: {}, code: 'MISSING_FIELD' }
  ],
  run (input) {
    const parts = String(input.token).trim().split('.');
    if (parts.length !== 3) {
      return fail('INVALID_INPUT', `A JWT has three parts separated by dots — this has ${parts.length}.`, 'token');
    }

    let header, payload;
    try { header = b64urlToJson(parts[0]); }
    catch { return fail('INVALID_INPUT', 'The first part is not readable as a JSON header.', 'token'); }
    try { payload = b64urlToJson(parts[1]); }
    catch { return fail('INVALID_INPUT', 'The second part is not readable as JSON claims.', 'token'); }
    if (header === null || typeof header !== 'object' || Array.isArray(header)) {
      return fail('INVALID_INPUT', 'The header decoded, but it is not a JSON object.', 'token');
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return fail('INVALID_INPUT', 'The claims decoded, but they are not a JSON object.', 'token');
    }

    return ok({
      header, payload,
      headerJson: JSON.stringify(header, null, 2),
      payloadJson: JSON.stringify(payload, null, 2),
      algorithm: typeof header.alg === 'string' ? header.alg : 'unstated',
      claimCount: Object.keys(payload).length,
      expiresAt: asIso(payload.exp), issuedAt: asIso(payload.iat),
      signaturePresent: parts[2].length > 0
    }, computed());
  }
};
