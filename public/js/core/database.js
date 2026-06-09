const DB = (() => {
  const DB_NAME = 'campus_errand_db';
  const DB_VERSION = 1;

  const STORE_CONFIG = {
    orders: { keyPath: 'id', indexes: ['code', 'status', 'studentId', 'runnerId', 'createdAt'] },
    runners: { keyPath: 'id', indexes: ['isBusy', 'name'] },
    coupons: { keyPath: 'id', indexes: ['code', 'used'] },
    auditLogs: { keyPath: 'id', indexes: ['timestamp', 'action', 'actor', 'target'] },
    locks: { keyPath: 'id', indexes: ['expiresAt'] },
    exceptionNotes: { keyPath: 'id', indexes: ['orderId', 'version'] },
    cancelRecords: { keyPath: 'id', indexes: ['orderId', 'timestamp'] },
    feeCalculations: { keyPath: 'id', indexes: ['orderId', 'timestamp'] }
  };

  const STORE_NAMES = Object.freeze({
    orders: 'orders',
    runners: 'runners',
    coupons: 'coupons',
    auditLogs: 'auditLogs',
    locks: 'locks',
    exceptionNotes: 'exceptionNotes',
    cancelRecords: 'cancelRecords',
    feeCalculations: 'feeCalculations'
  });

  const STORES = STORE_CONFIG;

  function resolveStoreName(nameOrConfig) {
    if (typeof nameOrConfig === 'string') return nameOrConfig;
    if (nameOrConfig && typeof nameOrConfig === 'object') {
      const found = Object.keys(STORE_CONFIG).find(k => STORE_CONFIG[k] === nameOrConfig);
      if (found) return found;
      if (nameOrConfig.keyPath) {
        const byKeyPath = Object.keys(STORE_CONFIG).find(k => STORE_CONFIG[k].keyPath === nameOrConfig.keyPath);
        if (byKeyPath) return byKeyPath;
      }
    }
    return String(nameOrConfig);
  }

  function resolveStoreNames(names) {
    if (Array.isArray(names)) return names.map(resolveStoreName);
    return resolveStoreName(names);
  }

  let dbInstance = null;
  let initPromise = null;

  function open() {
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(new Error('IndexedDB 打开失败: ' + request.error));
      request.onsuccess = () => {
        dbInstance = request.result;
        resolve(dbInstance);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        Object.keys(STORE_CONFIG).forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            const config = STORE_CONFIG[storeName];
            const store = db.createObjectStore(storeName, { keyPath: config.keyPath });
            (config.indexes || []).forEach(idx => {
              store.createIndex(idx, idx, { unique: false });
            });
          }
        });
      };
    });

    return initPromise;
  }

  function getDB() {
    if (!dbInstance) throw new Error('IndexedDB 未初始化');
    return dbInstance;
  }

  function tx(storeNames, mode = 'readonly') {
    const resolved = resolveStoreNames(storeNames);
    return getDB().transaction(resolved, mode);
  }

  function getAll(storeName) {
    const sn = resolveStoreName(storeName);
    return new Promise((resolve, reject) => {
      const store = tx(sn).objectStore(sn);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getByIndex(storeName, indexName, value) {
    const sn = resolveStoreName(storeName);
    return new Promise((resolve, reject) => {
      const store = tx(sn).objectStore(sn);
      const idx = store.index(indexName);
      const request = idx.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getByKeyRange(storeName, indexName, lower, upper, lowerOpen = false, upperOpen = false) {
    const sn = resolveStoreName(storeName);
    return new Promise((resolve, reject) => {
      const store = tx(sn).objectStore(sn);
      const idx = store.index(indexName);
      const range = IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen);
      const request = idx.getAll(range);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function get(storeName, key) {
    const sn = resolveStoreName(storeName);
    return new Promise((resolve, reject) => {
      const store = tx(sn).objectStore(sn);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function put(storeName, record) {
    const sn = resolveStoreName(storeName);
    return new Promise((resolve, reject) => {
      const transaction = tx(sn, 'readwrite');
      const store = transaction.objectStore(sn);
      const request = store.put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function putMany(storeName, records) {
    const sn = resolveStoreName(storeName);
    return new Promise((resolve, reject) => {
      const transaction = tx(sn, 'readwrite');
      const store = transaction.objectStore(sn);
      records.forEach(r => store.put(r));
      transaction.oncomplete = () => resolve(records);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function remove(storeName, key) {
    const sn = resolveStoreName(storeName);
    return new Promise((resolve, reject) => {
      const transaction = tx(sn, 'readwrite');
      const store = transaction.objectStore(sn);
      const request = store.delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  function clear(storeName) {
    const sn = resolveStoreName(storeName);
    return new Promise((resolve, reject) => {
      const transaction = tx(sn, 'readwrite');
      const store = transaction.objectStore(sn);
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  function clearAll() {
    return Promise.all(Object.keys(STORE_CONFIG).map(s => clear(s)));
  }

  function getCount(storeName) {
    const sn = resolveStoreName(storeName);
    return new Promise((resolve, reject) => {
      const store = tx(sn).objectStore(sn);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function runWithTransaction(storeNames, mode, fn) {
    await open();
    const resolved = resolveStoreNames(storeNames);
    const transaction = tx(resolved, mode);
    const stores = {};
    (Array.isArray(resolved) ? resolved : [resolved]).forEach(n => { stores[n] = transaction.objectStore(n); });
    try {
      const result = await fn(stores, transaction);
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(new Error('事务已中止'));
      });
    } catch (e) {
      try { transaction.abort(); } catch (_) {}
      throw e;
    }
  }

  return {
    STORES,
    STORE_NAMES,
    STORE_CONFIG,
    open,
    getAll,
    getByIndex,
    getByKeyRange,
    get,
    put,
    putMany,
    remove,
    clear,
    clearAll,
    getCount,
    runWithTransaction,
    tx,
    getDB
  };
})();
