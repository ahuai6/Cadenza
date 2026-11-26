const { randomUUID, randomBytes, createHash, createPublicKey, verify } = require('node:crypto');
const { createServer } = require('node:http');

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const direct = 'chatgpt.tokens.use.direct';
const scope = { domain: 'ai', provider: 'chatgpt', account: 'default' };
const random = () => randomBytes(32).toString('base64url');
const problem = (code) => Object.assign(new Error(code), { code });

async function validateIdentity(token, clientId, nonce, request) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw problem('identity');
  const [header, payload, sig] = parts;
  const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  const h = decode(header);
  const claims = decode(payload);
  if (h.alg !== 'RS256' || typeof h.kid !== 'string') throw problem('identity');
  const { keys } = await request('/.well-known/jwks.json');
  const key = keys?.find((item) => item.kid === h.kid && item.kty === 'RSA');
  const audiences = [].concat(claims.aud || []);
  if (
    !key ||
    !verify(
      'RSA-SHA256',
      Buffer.from(header + '.' + payload),
      createPublicKey({ key, format: 'jwk' }),
      Buffer.from(sig, 'base64url'),
    ) ||
    claims.iss !== issuer ||
    !audiences.includes(clientId) ||
    ((audiences.length > 1 || claims.azp) && claims.azp !== clientId) ||
    !Number.isFinite(claims.exp) ||
    claims.exp * 1000 <= Date.now() ||
    claims.nonce !== nonce ||
    typeof claims.sub !== 'string' ||
    !claims.sub
  )
    throw problem('identity');
  return claims.sub;
}

function chatgptAuth(vault, openBrowser, fetcher = fetch) {
  let pending;
  let serial = Promise.resolve();
  function transaction(action) {
    const next = serial.then(action);
    serial = next.catch(() => {});
    return next;
  }
  async function request(route, body) {
    const options = body ? { method: 'POST', body: new URLSearchParams(body) } : {};
    const res = await fetcher(issuer + route, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw problem(res.status === 429 ? 'rate-limit' : res.status < 500 ? 'authorization' : 'service');
    return res.status === 204 || route.endsWith('/revoke') ? null : res.json();
  }
  function token(grant) {
    return request('/api/accounts/oauth/token', { ...grant, resource });
  }
  function session(result, previous) {
    if (typeof result?.access_token !== 'string' || !Number.isFinite(result.expires_in) || result.expires_in <= 0)
      throw problem('authorization');
    return {
      ...previous,
      access: result.access_token,
      refresh: result.refresh_token || previous.refresh,
      scopes: typeof result.scope === 'string' ? result.scope.split(/\s+/) : previous.scopes,
      expires: Date.now() + result.expires_in * 1000,
    };
  }
  function cancel() {
    pending?.abort();
  }
  async function signIn() {
    cancel();
    const controller = new AbortController();
    pending = controller;
    const { signal } = controller;
    try {
      return await transaction(async () => {
        signal.throwIfAborted();
        const prior = await vault.read(scope);
        const host = prior?.host || 'urn:uuid:' + randomUUID();
        if (!prior) await vault.save(scope, { host });
        const state = random(),
          nonce = random(),
          verifier = random();
        const server = createServer();
        let timer;
        try {
          await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
          });
          signal.throwIfAborted();
          const callback = 'http://127.0.0.1:' + server.address().port + '/auth/callback';
          const result = new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(problem('canceled')), { once: true });
            timer = setTimeout(() => reject(problem('timeout')), 180000);
            server.on('request', (req, res) => {
              let url;
              try {
                url = new URL(req.url || '/', callback);
              } catch {
                res.writeHead(400).end();
                return;
              }
              if (
                req.method !== 'GET' ||
                req.headers.host !== new URL(callback).host ||
                url.pathname !== '/auth/callback' ||
                url.searchParams.getAll('state').length !== 1 ||
                url.searchParams.get('state') !== state
              ) {
                res.writeHead(404).end();
                return;
              }
              const issued = url.searchParams.get('client_id');
              const client = prior?.client || issued;
              const code = url.searchParams.get('code');
              const valid =
                !url.searchParams.has('error') &&
                code &&
                /^oaiapp_[\w-]{1,150}$/.test(client || '') &&
                (!issued || issued === client) &&
                url.searchParams.getAll('code').length === 1;
              res
                .writeHead(valid ? 200 : 400, {
                  'Content-Type': 'text/plain; charset=utf-8',
                  'Cache-Control': 'no-store',
                })
                .end(valid ? 'Return to Cadenza to finish signing in.' : 'Cadenza authorization did not complete.');
              if (valid) resolve({ client, code });
              else reject(problem('authorization'));
            });
          });
          const url = new URL(issuer + '/api/accounts/authorize');
          url.search = new URLSearchParams({
            response_type: 'code',
            client_id: prior?.client || 'dynamic_agent_client',
            redirect_uri: callback,
            scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
            resource,
            state,
            nonce,
            ext_agent_host_id: host,
            ...(prior?.client ? {} : { agent_name_hint: 'Cadenza' }),
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
            ...(prior?.identityToken ? { id_token_hint: prior.identityToken } : {}),
          });
          const { client, code } = await Promise.all([result, openBrowser(url.toString())]).then(([value]) => value);
          const issued = await token({
            grant_type: 'authorization_code',
            client_id: client,
            code,
            code_verifier: verifier,
            redirect_uri: callback,
          });
          const subject = await validateIdentity(issued.id_token, client, nonce, request);
          if (prior?.subject && subject !== prior.subject) throw problem('identity');
          signal.throwIfAborted();
          await vault.save(
            scope,
            session(issued, { host, client, subject, identityToken: issued.id_token, scopes: [] }),
          );
        } finally {
          clearTimeout(timer);
          server.close();
          server.closeIdleConnections();
        }
      });
    } finally {
      if (pending === controller) pending = undefined;
    }
  }
  return {
    signIn,
    cancel,
    async state() {
      const saved = await vault.read(scope);
      return { connected: !!saved?.subject, inference: !!saved?.scopes?.includes(direct) };
    },
    signOut() {
      cancel();
      return transaction(async () => {
        const saved = await vault.read(scope);
        if (!saved) return;
        let failure;
        try {
          if (saved.refresh || saved.access)
            await request('/api/accounts/oauth/revoke', {
              client_id: saved.client,
              token: saved.refresh || saved.access,
              token_type_hint: saved.refresh ? 'refresh_token' : 'access_token',
            });
        } catch {
          failure = problem('revocation-failed');
        }
        await vault.save(scope, { host: saved.host });
        if (failure) throw failure;
      });
    },
    access() {
      return transaction(async () => {
        let saved = await vault.read(scope);
        if (!saved?.subject) throw problem('sign-in-required');
        if (!saved.scopes.includes(direct)) throw problem('plan-access');
        if (saved.expires <= Date.now() + 60000) {
          if (!saved.refresh) throw problem('sign-in-required');
          saved = session(
            await token({ grant_type: 'refresh_token', client_id: saved.client, refresh_token: saved.refresh }),
            saved,
          );
          await vault.save(scope, saved);
          if (!saved.scopes.includes(direct)) throw problem('plan-access');
        }
        return saved.access;
      });
    },
  };
}

module.exports = { chatgptAuth, validateIdentity };
