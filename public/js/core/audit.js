const Audit = (() => {
  const subscribers = new Set();

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  function notify(log) {
    subscribers.forEach(fn => {
      try { fn(log); } catch (_) {}
    });
  }

  async function log(action, target, data = {}, level = 'INFO') {
    const currentUser = Storage.getCurrentUser();
    const entry = Models.createAuditLog(action, currentUser.id, target, data, level);
    entry.actorRole = Storage.getCurrentRole();
    entry.actorName = currentUser.name;
    entry.sessionId = Storage.getSessionId();

    try {
      await DB.open();
      await DB.put(DB.STORES.auditLogs, entry);
    } catch (e) {
      console.warn('审计日志写入IndexedDB失败:', e);
    }

    notify(entry);
    return entry;
  }

  async function query(filters = {}) {
    await DB.open();
    let logs = await DB.getAll(DB.STORES.auditLogs);

    if (filters.fromTime) {
      logs = logs.filter(l => l.timestamp >= filters.fromTime);
    }
    if (filters.toTime) {
      logs = logs.filter(l => l.timestamp <= filters.toTime);
    }
    if (filters.action) {
      logs = logs.filter(l => l.action === filters.action);
    }
    if (filters.actor) {
      logs = logs.filter(l => l.actor === filters.actor);
    }
    if (filters.target) {
      logs = logs.filter(l => l.target === filters.target);
    }
    if (filters.level && filters.level !== 'all') {
      logs = logs.filter(l => l.level === filters.level);
    }

    logs.sort((a, b) => b.timestamp - a.timestamp);
    return logs;
  }

  async function getRecent(limit = 100) {
    const logs = await query({});
    return logs.slice(0, limit);
  }

  async function exportForOrder(orderId) {
    await DB.open();
    const allLogs = await DB.getAll(DB.STORES.auditLogs);
    return allLogs
      .filter(l => l.target === orderId || (l.data && l.data.orderId === orderId))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async function clear() {
    await DB.open();
    return DB.clear(DB.STORES.auditLogs);
  }

  const ACTIONS = Object.freeze({
    ORDER_CREATE: 'ORDER_CREATE',
    ORDER_UPDATE: 'ORDER_UPDATE',
    ORDER_STATUS_CHANGE: 'ORDER_STATUS_CHANGE',
    ORDER_CANCEL: 'ORDER_CANCEL',
    ORDER_ACCEPT: 'ORDER_ACCEPT',
    ORDER_ACCEPT_CONFLICT: 'ORDER_ACCEPT_CONFLICT',
    ORDER_ACCEPT_RETRY: 'ORDER_ACCEPT_RETRY',
    ORDER_PICK: 'ORDER_PICK',
    ORDER_DELIVER: 'ORDER_DELIVER',
    ORDER_EXCEPTION: 'ORDER_EXCEPTION',
    ORDER_PAY: 'ORDER_PAY',
    FEE_CALCULATE: 'FEE_CALCULATE',
    FEE_RECALCULATE: 'FEE_RECALCULATE',
    RUNNER_BUSY_SET: 'RUNNER_BUSY_SET',
    RUNNER_BUSY_CLEAR: 'RUNNER_BUSY_CLEAR',
    COUPON_USE: 'COUPON_USE',
    EXCEPTION_NOTE_ADD: 'EXCEPTION_NOTE_ADD',
    EXCEPTION_NOTE_EDIT: 'EXCEPTION_NOTE_EDIT',
    FINANCE_REVIEW: 'FINANCE_REVIEW',
    FINANCE_REFUND_APPROVE: 'FINANCE_REFUND_APPROVE',
    FINANCE_REFUND_REJECT: 'FINANCE_REFUND_REJECT',
    ROLE_SWITCH: 'ROLE_SWITCH',
    EXPORT_DATA: 'EXPORT_DATA',
    LOGIN: 'LOGIN',
    LOCK_ACQUIRE: 'LOCK_ACQUIRE',
    LOCK_RELEASE: 'LOCK_RELEASE',
    LOCK_CONFLICT: 'LOCK_CONFLICT',
    OVERWEIGHT_CONFIRM: 'OVERWEIGHT_CONFIRM'
  });

  return {
    ACTIONS,
    log,
    query,
    getRecent,
    exportForOrder,
    clear,
    subscribe
  };
})();
