const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { replace, assertDirectory } = require('./library-storage.cjs');

const capabilities = [
  'search',
  'account',
  'playlists',
  'recommendations',
  'charts',
  'lyrics',
  'preview',
  'download',
  'open',
];
const planned = [
  { id: 'netease', name: 'NetEase Cloud Music', label: 'hall.netease' },
  { id: 'qq', name: 'QQ Music', label: 'hall.qq' },
  { id: 'kugou', name: 'KuGou', label: 'hall.kugou' },
  { id: 'apple', name: 'Apple Music' },
  { id: 'lyricsflow', name: 'LyricsFlow' },
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

function createOnlineService({ vault, catalog = planned } = {}) {
  const providers = new Map(catalog.map((p) => [p.id, p]));
  const adapters = new Map();
  const accounts = new Map();
  const tasks = new Set();
  let preview;

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
    providers.set(id, { id, name: descriptor.name, label: descriptor.label });
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
  function snapshot() {
    return {
      providers: Array.from(providers.values(), (p) => ({
        id: p.id,
        name: p.name,
        label: p.label,
        capabilities: Object.fromEntries(
          capabilities.map((cap) => [cap, adapters.get(p.id)?.capabilities[cap] || 'unavailable']),
        ),
      })),
      accounts: Array.from(accounts.values(), (account) => ({ ...account })),
      ai: aiProviders.map((provider) => ({ ...provider, state: 'unavailable' })),
    };
  }
  // Results stay in main. A future IPC command should project each result into an explicit public DTO.
  async function invoke({ provider, capability, account, input, owner }) {
    const adapter = adapters.get(provider);
    const access = adapter && Object.hasOwn(adapter.capabilities, capability) && adapter.capabilities[capability];
    if (!access) throw new OnlineError('unavailable');
    const scope = account && { domain: 'music', provider, account };
    if (access === 'authorized' && (!scope || accounts.get(accountKey(provider, account))?.state !== 'connected'))
      throw new OnlineError('sign-in-required');
    const controller = new AbortController();
    const task = { owner, controller, detached: capability === 'download' || capability === 'account' };
    tasks.add(task);
    if (capability === 'preview') {
      preview?.abort();
      preview = controller;
    }
    try {
      const secret = access === 'authorized' ? await vault.read(scope) : null;
      controller.signal.throwIfAborted();
      if (access === 'authorized' && !secret) throw new OnlineError('sign-in-required');
      const result = await adapter.operations[capability](input, { signal: controller.signal, secret });
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (controller.signal.aborted) throw new OnlineError('cancelled');
      if (error instanceof OnlineError) throw error;
      throw new OnlineError('provider-failed');
    } finally {
      tasks.delete(task);
      if (preview === controller) preview = undefined;
    }
  }
  function closeOwner(owner) {
    for (const task of tasks) if (task.owner === owner && !task.detached) task.controller.abort();
  }
  function close() {
    for (const task of tasks) task.controller.abort();
  }
  return { register, invoke, snapshot, setAccount, closeOwner, close };
}

module.exports = { createOnlineService, credentialVault, OnlineError };
