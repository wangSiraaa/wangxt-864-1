const DB = (() => {
  const DB_NAME = 'campus_errand_db';
  const DB_VERSION = 1;

  const STORES = {
    orders: { keyPath: 'id', indexes: ['code', 'status', 'studentId', 'runnerId', 'createdAt'] },
    runners: { keyPath: 'id', indexes: ['isBusy', 'name'] },
    coupons: { keyPath: 'id', indexes: ['code', 'used'] },
    auditLogs: { keyPath: 'id', indexes: ['timestamp', 'action', 'actor', 'target'] },
    locks: { keyPath: 'id', indexes: ['expiresAt'] },
    exceptionNotes: { keyPath: 'id', indexes: ['orderId', 'version'] },
    cancelRecords: { keyPath: 'id', indexes: ['orderId', 'timestamp'] },
    feeCalculations: { keyPath: 'id', indexes: ['orderId', 'timestamp'] }
  };

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

        Object.keys(STORES).forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            const config = STORES[storeName];
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
    return getDB().transaction(storeNames, mode);
  }

  function getAll(storeName) {
    return new Promise((resolve, reject) => {
      const store = tx(storeName).objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
      const store = tx(storeName).objectStore(storeName);
      const idx = store.index(indexName);
      const request = idx.getAll(value);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getByKeyRange(storeName, indexName, lower, upper, lowerOpen = false, upperOpen = false) {
    return new Promise((resolve, reject) => {
      const store = tx(storeName).objectStore(storeName);
      const idx = store.index(indexName);
      const range = IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen);
      const request = idx.getAll(range);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function get(storeName, key) {
    return new Promise((resolve, reject) => {
      const store = tx(storeName).objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function put(storeName, record) {
    return new Promise((resolve, reject) => {
      const transaction = tx(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function putMany(storeName, records) {
    return new Promise((resolve, reject) => {
      const transaction = tx(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      records.forEach(r => store.put(r));
      transaction.oncomplete = () => resolve(records);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function remove(storeName, key) {
    return new Promise((resolve, reject) => {
      const transaction = tx(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  function clear(storeName) {
    return new Promise((resolve, reject) => {
      const transaction = tx(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  function clearAll() {
    return Promise.all(Object.keys(STORES).map(s => clear(s)));
  }

  function getCount(storeName) {
    return new Promise((resolve, reject) => {
      const store = tx(storeName).objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function runWithTransaction(storeNames, mode, fn) {
    await open();
    const transaction = tx(storeNames, mode);
    const stores = {};
    storeNames.forEach(n => { stores[n] = transaction.objectStore(n); });
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
