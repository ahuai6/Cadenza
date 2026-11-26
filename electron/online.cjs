const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { replace, assertDirectory } = require('./library-storage.cjs');

const capabilities = [
  'search',
  'account',
  'playlists',
  'collection',
  'recommendations',
  'charts',
  'lyrics',
  'preview',
  'download',
  'variants',
  'open',
];
const planned = [
  { id: 'netease', name: 'NetEase Cloud Music', label: 'hall.netease' },
  { id: 'qq', name: 'QQ Music', label: 'hall.qq' },
  { id: 'kugou', name: 'KuGou', label: 'hall.kugou' },
  { id: 'apple', name: 'Apple Music' },
];
const aiProviders = [
  { id: 'chatgpt', name: 'ChatGPT', auth: 'oauth' },
  { id: 'deepseek', name: 'DeepSeek', auth: 'api-key' },
];

class OnlineError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// Separate music and AI namespaces, then provider and account. Values remain inside the main process.
function credentialVault(root, safeStorage) {
  function location(scope) {
    if (!['music', 'ai'].includes(scope.domain) || !validId(scope.provider) || !validId(scope.account))
      throw new OnlineError('invalid');
    const key = createHash('sha256')
      .update(JSON.stringify([scope.domain, scope.provider, scope.account]))
      .digest('hex');
    return path.join(root, `${scope.domain}-${key}.secret`);
  }
  function encrypted() {
    return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  }
  return {
    async save(scope, value) {
      const file = location(scope);
      if (!encrypted()) throw new OnlineError('storage-unavailable');
      await fs.mkdir(root, { recursive: true });
      await assertDirectory(root);
      await replace(file, safeStorage.encryptString(JSON.stringify(value)));
    },
    async read(scope) {
      const file = location(scope);
      if (!encrypted()) throw new OnlineError('storage-unavailable');
      try {
        await assertDirectory(root);
        if (!(await fs.lstat(file)).isFile()) throw new OnlineError('storage-unavailable');
        return JSON.parse(safeStorage.decryptString(await fs.readFile(file)));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async remove(scope) {
      const file = location(scope);
      try {
        await assertDirectory(root);
        await fs.rm(file, { force: true });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    },
  };
}

const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);

function createOnlineService({ vault, accountFile, catalog = planned } = {}) {
  const providers = new Map(catalog.map((p) => [p.id, p]));
  const adapters = new Map();
  const accounts = new Map();
  const tasks = new Set();
  let preview;
  const results = new Map();

  function register(descriptor, operations) {
    const { id } = descriptor;
    if (!validId(id) || adapters.has(id)) throw new OnlineError('invalid');
    const declared = Object.entries(descriptor.capabilities);
    if (
      declared.some(
        ([key, access]) =>
          !capabilities.includes(key) ||
          !['public', 'authorized'].includes(access) ||
          typeof operations[key] !== 'function',
      )
    )
      throw new OnlineError('invalid');
    providers.set(id, { id, name: descriptor.name, label: descriptor.label, configuration: descriptor.configuration });
    adapters.set(id, { capabilities: { ...descriptor.capabilities }, operations: { ...operations } });
  }
  const accountKey = (provider, id) => JSON.stringify([provider, id]);
  function setAccount(provider, { id, name, state }) {
    if (
      !adapters.has(provider) ||
      !validId(id) ||
      typeof name !== 'string' ||
      !['connected', 'expired', 'disconnected'].includes(state)
    )
      throw new OnlineError('invalid');
    accounts.set(accountKey(provider, id), { provider, id, name, state });
  }
  let accountWrites = Promise.resolve();
  const writeAccounts = () => {
    if (!accountFile) return Promise.resolve();
    const body = JSON.stringify([...accounts.values()]);
    accountWrites = accountWrites
      .catch(() => {})
      .then(async () => {
        await assertDirectory(path.dirname(accountFile));
        await replace(accountFile, body);
      });
    return accountWrites;
  };
  async function restoreAccounts() {
    if (!accountFile) return;
    try {
      await assertDirectory(path.dirname(accountFile));
      if (!(await fs.lstat(accountFile)).isFile()) return;
      const values = JSON.parse(await fs.readFile(accountFile, 'utf8'));
      if (!Array.isArray(values)) return;
      for (const item of values.slice(0, 50)) {
        if (!adapters.has(item.provider) || !validId(item.id)) continue;
        try {
          const secret = await vault.read({ domain: 'music', provider: item.provider, account: item.id });
          setAccount(item.provider, { id: item.id, name: item.name, state: secret ? item.state : 'expired' });
        } catch {
          setAccount(item.provider, { id: item.id, name: item.name, state: 'expired' });
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[online] account index unavailable');
    }
  }
  async function connect(provider, account, secret) {
    await vault.save({ domain: 'music', provider, account: account.id }, secret);
    setAccount(provider, { ...account, state: 'connected' });
    await writeAccounts();
  }
  async function disconnect(provider, id) {
    await vault.remove({ domain: 'music', provider, account: id });
    accounts.delete(accountKey(provider, id));
    await writeAccounts();
  }
  function snapshot() {
    return {
      providers: Array.from(providers.values(), (p) => ({
        id: p.id,
        name: p.name,
        label: p.label,
        configuration: p.configuration,
        capabilities: Object.fromEntries(
          capabilities.map((cap) => [cap, adapters.get(p.id)?.capabilities[cap] || 'unavailable']),
        ),
      })),
      accounts: Array.from(accounts.values(), (account) => ({ ...account })),
      ai: aiProviders.map((provider) => ({ ...provider, state: 'unavailable' })),
    };
  }
  function requireAccess(provider, capability, account) {
    const adapter = adapters.get(provider);
    const access = adapter && Object.hasOwn(adapter.capabilities, capability) && adapter.capabilities[capability];
    if (!access) throw new OnlineError('unavailable');
    if (access === 'authorized') {
      const state = accounts.get(accountKey(provider, account))?.state;
      if (state !== 'connected') throw new OnlineError(state === 'expired' ? 'expired' : 'sign-in-required');
    }
    return access;
  }
  // Sensitive adapter results stay in main. Only projected catalog data and task status cross IPC.
  async function invoke({ provider, capability, account, input, owner, lane, signal }) {
    const access = requireAccess(provider, capability, account);
    const adapter = adapters.get(provider);
    const scope = access === 'authorized' ? { domain: 'music', provider, account } : null;
    if (lane) cancel(owner, lane);
    const cacheable = ['search', 'charts', 'recommendations', 'collection'].includes(capability) && access === 'public';
    const key = cacheable && JSON.stringify([provider, capability, input]);
    const saved = key && results.get(key);
    if (saved && saved.expires > Date.now()) return saved.value;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    const task = { owner, lane, controller, detached: capability === 'download' || capability === 'account' };
    tasks.add(task);
    if (capability === 'preview') {
      preview?.abort();
      preview = controller;
    }
    try {
      const secret = access === 'authorized' ? await vault.read(scope) : null;
      controller.signal.throwIfAborted();
      if (access === 'authorized' && !secret) throw new OnlineError('sign-in-required');
      const result = await adapter.operations[capability](input, { signal: controller.signal, secret, owner });
      controller.signal.throwIfAborted();
      if (key) {
        if (results.size >= 48) results.delete(results.keys().next().value);
        results.set(key, { value: result, expires: Date.now() + 120000 });
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new OnlineError('cancelled');
      if (error instanceof OnlineError) {
        const current = scope && accounts.get(accountKey(provider, account));
        if (error.code === 'expired' && current) {
          current.state = 'expired';
          await writeAccounts().catch(() => {});
        }
        throw error;
      }
      throw new OnlineError('provider-failed');
    } finally {
      signal?.removeEventListener('abort', abort);
      tasks.delete(task);
      if (preview === controller) preview = undefined;
    }
  }
  function cancel(owner, lane) {
    for (const task of tasks) if (task.owner === owner && task.lane === lane && !task.detached) task.controller.abort();
  }
  function closeOwner(owner) {
    for (const task of tasks) if (task.owner === owner && !task.detached) task.controller.abort();
  }
  function close() {
    for (const task of tasks) task.controller.abort();
  }
  return {
    register,
    invoke,
    requireAccess,
    snapshot,
    setAccount,
    connect,
    disconnect,
    restoreAccounts,
    cancel,
    closeOwner,
    close,
  };
}

module.exports = { createOnlineService, credentialVault, OnlineError };
