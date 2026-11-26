const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { replace, assertDirectory } = require('./library-storage.cjs');

class CredentialError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// AI credentials are scoped by provider and account and remain inside the main process.
function credentialVault(root, safeStorage) {
  function location(scope) {
    if (scope.domain !== 'ai' || !validId(scope.provider) || !validId(scope.account))
      throw new CredentialError('invalid');
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
      if (!encrypted()) throw new CredentialError('storage-unavailable');
      await fs.mkdir(root, { recursive: true });
      await assertDirectory(root);
      await replace(file, safeStorage.encryptString(JSON.stringify(value)));
    },
    async read(scope) {
      const file = location(scope);
      if (!encrypted()) throw new CredentialError('storage-unavailable');
      try {
        await assertDirectory(root);
        if (!(await fs.lstat(file)).isFile()) throw new CredentialError('storage-unavailable');
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

module.exports = { credentialVault };
