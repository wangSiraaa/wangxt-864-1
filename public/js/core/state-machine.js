const StateMachine = (() => {
  const ORDER_STATUSES = Models.ORDER_STATUSES;

  const TRANSITIONS = {
    [ORDER_STATUSES.PENDING_PAYMENT]: {
      allowedNext: [ORDER_STATUSES.PENDING_ACCEPT, ORDER_STATUSES.CANCELLED],
      actions: ['pay', 'cancel']
    },
    [ORDER_STATUSES.PENDING_ACCEPT]: {
      allowedNext: [ORDER_STATUSES.ACCEPTED, ORDER_STATUSES.CANCELLED],
      actions: ['accept', 'cancel']
    },
    [ORDER_STATUSES.ACCEPTED]: {
      allowedNext: [ORDER_STATUSES.PICKING, ORDER_STATUSES.CANCELLED, ORDER_STATUSES.EXCEPTION],
      actions: ['start_pick', 'cancel', 'raise_exception']
    },
    [ORDER_STATUSES.PICKING]: {
      allowedNext: [ORDER_STATUSES.DELIVERING, ORDER_STATUSES.CANCELLED, ORDER_STATUSES.EXCEPTION],
      actions: ['start_deliver', 'cancel', 'raise_exception']
    },
    [ORDER_STATUSES.DELIVERING]: {
      allowedNext: [ORDER_STATUSES.DELIVERED, ORDER_STATUSES.CANCELLED, ORDER_STATUSES.EXCEPTION],
      actions: ['complete', 'cancel', 'raise_exception']
    },
    [ORDER_STATUSES.DELIVERED]: {
      allowedNext: [],
      actions: []
    },
    [ORDER_STATUSES.CANCELLED]: {
      allowedNext: [ORDER_STATUSES.EXCEPTION],
      actions: ['raise_exception']
    },
    [ORDER_STATUSES.EXCEPTION]: {
      allowedNext: [ORDER_STATUSES.PENDING_ACCEPT, ORDER_STATUSES.CANCELLED, ORDER_STATUSES.PENDING_PAYMENT],
      actions: ['resolve_reaccept', 'resolve_cancel', 'resolve_repay']
    }
  };

  function getNextStatuses(currentStatus) {
    const transitions = TRANSITIONS[currentStatus];
    if (!transitions) return [];
    return transitions.allowedNext || [];
  }

  function canTransition(currentStatus, nextStatus) {
    const allowed = getNextStatuses(currentStatus);
    return allowed.includes(nextStatus);
  }

  function addStatusHistoryEntry(oldStatus, newStatus, actor, note = null) {
    return {
      id: Models.generateId('st_'),
      from: oldStatus,
      to: newStatus,
      timestamp: Date.now(),
      actor: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      note
    };
  }

  async function transition(order, newStatus, actor, note = null) {
    if (!canTransition(order.status, newStatus)) {
      throw new Error(
        '状态转换不允许：' + Models.STATUS_LABELS[order.status] +
        ' -> ' + Models.STATUS_LABELS[newStatus]
      );
    }

    const entry = addStatusHistoryEntry(order.status, newStatus, actor, note);

    const oldStatus = order.status;
    order.status = newStatus;
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push(entry);
    order.updatedAt = Date.now();

    switch (newStatus) {
      case ORDER_STATUSES.PENDING_ACCEPT:
        order.paidAt = Date.now();
        break;
      case ORDER_STATUSES.ACCEPTED:
        order.acceptedAt = Date.now();
        break;
      case ORDER_STATUSES.PICKING:
        order.pickedAt = order.pickedAt || Date.now();
        break;
      case ORDER_STATUSES.DELIVERING:
        order.deliveringAt = order.deliveringAt || Date.now();
        break;
      case ORDER_STATUSES.DELIVERED:
        order.deliveredAt = Date.now();
        break;
      case ORDER_STATUSES.CANCELLED:
        order.cancelledAt = Date.now();
        order.cancelledBy = actor.id;
        break;
    }

    await Audit.log(
      Audit.ACTIONS.ORDER_STATUS_CHANGE,
      order.id,
      {
        from: oldStatus,
        to: newStatus,
        note,
        actor: actor.id,
        actorName: actor.name
      },
      newStatus === ORDER_STATUSES.EXCEPTION ? 'WARN' : 'INFO'
    );

    return { order, entry };
  }

  function validatePreconditions(order, action, context = {}) {
    const errors = [];
    const transitions = TRANSITIONS[order.status];
    if (!transitions) {
      errors.push('未知状态：' + order.status);
      return { valid: false, errors };
    }
    if (!transitions.actions.includes(action)) {
      errors.push(
        '当前状态[' + Models.STATUS_LABELS[order.status] + ']下不允许操作：' + action
      );
    }

    switch (action) {
      case 'accept':
        if (!context.runner) {
          errors.push('必须指定跑腿员');
        } else {
          if (context.runner.isBusy) {
            errors.push('跑腿员忙碌中，无法接单');
          }
          if (order.runnerId && order.runnerId !== context.runner.id) {
            errors.push('订单已被其他跑腿员接单');
          }
        }
        if (order.status !== ORDER_STATUSES.PENDING_ACCEPT) {
          errors.push('订单状态非待接单');
        }
        if (order.feeDetail && order.feeDetail.overweight &&
            order.feeDetail.overweight.required && !order.overWeightConfirmed) {
          errors.push('超重费用未确认，无法接单');
        }
        break;
      case 'pay':
        if (order.status !== ORDER_STATUSES.PENDING_PAYMENT) {
          errors.push('订单已支付');
        }
        break;
      case 'cancel':
        if (!context.cancelReason) {
          errors.push('必须填写取消原因');
        }
        break;
      case 'raise_exception':
        if (!context.exceptionNote) {
          errors.push('必须填写异常说明');
        }
        break;
    }

    return { valid: errors.length === 0, errors };
  }

  function getCurrentActions(status) {
    const t = TRANSITIONS[status];
    return t ? t.actions : [];
  }

  function getStatusFlow() {
    return [
      ORDER_STATUSES.PENDING_PAYMENT,
      ORDER_STATUSES.PENDING_ACCEPT,
      ORDER_STATUSES.ACCEPTED,
      ORDER_STATUSES.PICKING,
      ORDER_STATUSES.DELIVERING,
      ORDER_STATUSES.DELIVERED
    ];
  }

  function getStatusNodeInfo(status, order) {
    const flow = getStatusFlow();
    const idx = flow.indexOf(status);
    const exceptionStates = [ORDER_STATUSES.EXCEPTION, ORDER_STATUSES.CANCELLED];
    const isException = exceptionStates.includes(status);
    return {
      idx,
      isEndNode: status === ORDER_STATUSES.DELIVERED || status === ORDER_STATUSES.CANCELLED,
      isException,
      isBeforeStart: idx === 0 || status === ORDER_STATUSES.CANCELLED,
      currentIndex: idx >= 0 ? idx : -1
    };
  }

  return {
    TRANSITIONS,
    canTransition,
    getNextStatuses,
    addStatusHistoryEntry,
    transition,
    validatePreconditions,
    getCurrentActions,
    getStatusFlow,
    getStatusNodeInfo
  };
})();
