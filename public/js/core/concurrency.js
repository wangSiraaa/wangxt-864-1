const Concurrency = (() => {
  const LOCK_TTL_MS = 30000;
  const OPERATION_TTL_MS = 60000;
  const OPERATION_PREFIX = 'op_idem_';

  const _activeLocks = new Map();
  const _operationIdem = new Map();

  function _genLockKey(resourceType, resourceId) {
    return resourceType + ':' + resourceId;
  }

  function _genOpKey(operation, resourceId, discriminator) {
    return OPERATION_PREFIX + operation + '_' + resourceId + '_' + (discriminator || '');
  }

  async function acquireLock(resourceType, resourceId, holder, ttlMs) {
    const key = _genLockKey(resourceType, resourceId);
    const lockId = Models.generateId('lock_');
    const now = Date.now();
    const ttl = ttlMs || LOCK_TTL_MS;
    const expiresAt = now + ttl;

    await DB.open();
    const existing = await DB.get(DB.STORES.locks, key);

    if (existing && existing.expiresAt > now && existing.holder !== holder) {
      await Audit.log(
        Audit.ACTIONS.LOCK_CONFLICT,
        resourceId,
        {
          resourceType,
          existingHolder: existing.holder,
          existingHolderName: existing.holderName,
          newHolder: holder,
          expiresAt: existing.expiresAt
        },
        'WARN'
      );
      return {
        acquired: false,
        reason: '资源已被锁定',
        conflictingLock: existing,
        message: '资源正在被' + (existing.holderName || '其他用户') + '处理中，请稍后重试'
      };
    }

    const lockRecord = {
      id: key,
      resourceType,
      resourceId,
      lockId,
      holder,
      holderName: (Storage.getCurrentUser() || {}).name || holder,
      acquiredAt: now,
      expiresAt,
      ttl,
      sessionId: Storage.getSessionId()
    };

    try {
      await DB.put(DB.STORES.locks, lockRecord);
      _activeLocks.set(key, lockRecord);
      await Audit.log(
        Audit.ACTIONS.LOCK_ACQUIRE,
        resourceId,
        { resourceType, holder, ttl, expiresAt },
        'INFO'
      );
      return { acquired: true, lock: lockRecord };
    } catch (e) {
      return {
        acquired: false,
        reason: '锁写入失败',
        error: e.message,
        message: '加锁失败：' + e.message
      };
    }
  }

  async function releaseLock(resourceType, resourceId, holder) {
    const key = _genLockKey(resourceType, resourceId);
    const existing = _activeLocks.get(key);

    await DB.open();
    const stored = await DB.get(DB.STORES.locks, key);

    if (stored && stored.holder !== holder) {
      return { released: false, reason: '非锁持有者释放' };
    }

    try {
      await DB.remove(DB.STORES.locks, key);
      _activeLocks.delete(key);
      if (stored) {
        await Audit.log(
          Audit.ACTIONS.LOCK_RELEASE,
          resourceId,
          { resourceType, holder, heldFor: Date.now() - stored.acquiredAt },
          'INFO'
        );
      }
      return { released: true };
    } catch (e) {
      return { released: false, reason: e.message };
    }
  }

  async function checkLock(resourceType, resourceId) {
    const key = _genLockKey(resourceType, resourceId);
    await DB.open();
    const stored = await DB.get(DB.STORES.locks, key);
    if (!stored) return { locked: false };

    if (stored.expiresAt < Date.now()) {
      await DB.remove(DB.STORES.locks, key);
      _activeLocks.delete(key);
      return { locked: false, stale: true, removed: true };
    }

    return { locked: true, lock: stored, timeLeft: stored.expiresAt - Date.now() };
  }

  function isIdempotent(operation, resourceId, discriminator) {
    const key = _genOpKey(operation, resourceId, discriminator);
    const op = _operationIdem.get(key);
    if (!op) return { executed: false };

    if (op.expiresAt < Date.now()) {
      _operationIdem.delete(key);
      return { executed: false, stale: true };
    }

    return {
      executed: true,
      operation: op,
      message: '操作已在' + new Date(op.executedAt).toLocaleTimeString() + '执行过'
    };
  }

  function markIdempotent(operation, resourceId, discriminator, result, ttlMs) {
    const key = _genOpKey(operation, resourceId, discriminator);
    const now = Date.now();
    const op = {
      key,
      operation,
      resourceId,
      discriminator,
      result,
      executedAt: now,
      expiresAt: now + (ttlMs || OPERATION_TTL_MS),
      sessionId: Storage.getSessionId()
    };
    _operationIdem.set(key, op);
    return op;
  }

  async function atomicAcceptOrder(orderId, runner) {
    const idemCheck = isIdempotent('ACCEPT_ORDER', orderId, runner.id);
    if (idemCheck.executed) {
      return {
        success: false,
        reason: 'IDEMPOTENT',
        message: idemCheck.message || '接单操作重复提交',
        previousResult: idemCheck.operation && idemCheck.operation.result
      };
    }

    const lockCheck = await acquireLock('ORDER', orderId, runner.id, 20000);
    if (!lockCheck.acquired) {
      await Audit.log(
        Audit.ACTIONS.ORDER_ACCEPT_CONFLICT,
        orderId,
        { runnerId: runner.id, runnerName: runner.name, conflictInfo: lockCheck },
        'WARN'
      );
      return {
        success: false,
        reason: lockCheck.reason || 'LOCK_FAILED',
        message: lockCheck.message || '抢单冲突，请稍后重试'
      };
    }

    try {
      await DB.open();
      const order = await DB.get(DB.STORES.orders, orderId);
      if (!order) {
        return { success: false, reason: 'NOT_FOUND', message: '订单不存在' };
      }

      const precond = StateMachine.validatePreconditions(order, 'accept', { runner });
      if (!precond.valid) {
        return {
          success: false,
          reason: 'PRECONDITION_FAILED',
          message: precond.errors.join('；'),
          errors: precond.errors
        };
      }

      if (order.runnerId && order.runnerId !== runner.id) {
        await Audit.log(
          Audit.ACTIONS.ORDER_ACCEPT_CONFLICT,
          orderId,
          {
            runnerId: runner.id,
            runnerName: runner.name,
            existingRunnerId: order.runnerId,
            existingRunnerName: order.runnerName
          },
          'WARN'
        );
        return {
          success: false,
          reason: 'ALREADY_TAKEN',
          message: '订单已被' + (order.runnerName || '其他跑腿员') + '抢先接单',
          existingRunner: { id: order.runnerId, name: order.runnerName }
        };
      }

      order.runnerId = runner.id;
      order.runnerName = runner.name;

      const actor = Object.assign({}, runner, { role: Models.ROLES.RUNNER });
      const transResult = await StateMachine.transition(
        order,
        Models.ORDER_STATUSES.ACCEPTED,
        actor,
        '跑腿员接单'
      );
      order = transResult.order;
      await DB.put(DB.STORES.orders, order);

      await Audit.log(
        Audit.ACTIONS.ORDER_ACCEPT,
        orderId,
        { runnerId: runner.id, runnerName: runner.name },
        'INFO'
      );

      markIdempotent('ACCEPT_ORDER', orderId, runner.id, {
        success: true,
        order,
        acceptedAt: order.acceptedAt
      });

      return { success: true, order };

    } catch (e) {
      await Audit.log(
        Audit.ACTIONS.ORDER_ACCEPT_RETRY,
        orderId,
        { runnerId: runner.id, error: e.message },
        'ERROR'
      );
      return {
        success: false,
        reason: 'EXCEPTION',
        message: e.message || '接单时发生错误'
      };
    } finally {
      await releaseLock('ORDER', orderId, runner.id);
    }
  }

  async function atomicUpdateOrder(orderId, updateFn, operationTag) {
    const idemKey = operationTag || ('UPDATE_' + orderId);
    const idemCheck = isIdempotent(idemKey, orderId);
    if (idemCheck.executed) {
      return { success: false, idempotent: true, previousResult: idemCheck.operation.result };
    }

    const lockCheck = await acquireLock('ORDER', orderId, Storage.getCurrentUser().id, 15000);
    if (!lockCheck.acquired) {
      return { success: false, locked: true, message: lockCheck.message };
    }

    try {
      await DB.open();
      const order = await DB.get(DB.STORES.orders, orderId);
      if (!order) {
        return { success: false, reason: 'NOT_FOUND', message: '订单不存在' };
      }

      const result = updateFn(order);
      await DB.put(DB.STORES.orders, order);

      markIdempotent(idemKey, orderId, null, { success: true, order, customResult: result });

      return { success: true, order, result };
    } catch (e) {
      return { success: false, reason: 'EXCEPTION', message: e.message };
    } finally {
      await releaseLock('ORDER', orderId, Storage.getCurrentUser().id);
    }
  }

  async function cleanupExpiredLocks() {
    await DB.open();
    const all = await DB.getAll(DB.STORES.locks);
    const now = Date.now();
    let removed = 0;
    for (const lock of all) {
      if (lock.expiresAt < now) {
        await DB.remove(DB.STORES.locks, lock.id);
        _activeLocks.delete(lock.id);
        removed++;
      }
    }
    return removed;
  }

  setInterval(cleanupExpiredLocks, 10000);

  function resetIdempotentCache() {
    _operationIdem.clear();
  }

  return {
    acquireLock,
    releaseLock,
    checkLock,
    isIdempotent,
    markIdempotent,
    atomicAcceptOrder,
    atomicUpdateOrder,
    cleanupExpiredLocks,
    resetIdempotentCache
  };
})();
