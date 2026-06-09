const Roles = (() => {
  const ROLE_USERS = {
    [Models.ROLES.STUDENT]: [
      { id: 'student_demo_1', name: '小明', className: '计科2201' },
      { id: 'student_demo_2', name: '小红', className: '软工2202' },
      { id: 'student_demo_3', name: '小刚', className: '信管2201' }
    ],
    [Models.ROLES.RUNNER]: [
      { id: 'runner_demo_1', name: '跑腿员_阿强', rating: 4.9, ordersCompleted: 128 },
      { id: 'runner_demo_2', name: '跑腿员_阿杰', rating: 4.8, ordersCompleted: 96 },
      { id: 'runner_demo_3', name: '跑腿员_小美', rating: 4.7, ordersCompleted: 73 }
    ],
    [Models.ROLES.ADMIN]: [
      { id: 'admin_demo_1', name: '管理员_王老师', department: '学工处' }
    ],
    [Models.ROLES.FINANCE]: [
      { id: 'finance_demo_1', name: '财务_李会计', department: '财务处' }
    ]
  };

  const PERMISSIONS = {
    [Models.ROLES.STUDENT]: {
      pages: ['order_create', 'order_list', 'order_detail_mine', 'coupon_mine'],
      actions: ['create_order', 'pay_order', 'cancel_order', 'view_own_orders']
    },
    [Models.ROLES.RUNNER]: {
      pages: ['order_pool', 'order_detail', 'runner_status', 'my_deliveries'],
      actions: ['accept_order', 'start_pick', 'start_deliver', 'complete_order',
                'raise_exception', 'set_busy', 'clear_busy']
    },
    [Models.ROLES.ADMIN]: {
      pages: ['all_orders', 'runner_management', 'exception_management', 'coupon_management'],
      actions: ['view_all_orders', 'manage_runners', 'manage_coupons',
                'edit_exception', 'force_resolve']
    },
    [Models.ROLES.FINANCE]: {
      pages: ['finance_review', 'finance_refund', 'finance_statistics'],
      actions: ['review_exception', 'approve_refund', 'reject_refund',
                'view_finance_statistics']
    }
  };

  function getUsersForRole(role) {
    return ROLE_USERS[role] || [];
  }

  function getDefaultUserForRole(role) {
    const users = getUsersForRole(role);
    return users.length > 0 ? users[0] : null;
  }

  function getPermissions(role) {
    return PERMISSIONS[role] || { pages: [], actions: [] };
  }

  function canAccessPage(role, pageKey) {
    return getPermissions(role).pages.includes(pageKey);
  }

  function canDoAction(role, actionKey) {
    return getPermissions(role).actions.includes(actionKey);
  }

  function requireRole(actionKey, role) {
    if (!canDoAction(role, actionKey)) {
      throw new Error(
        '权限不足：角色[' + Models.ROLE_LABELS[role] + ']不允许操作[' + actionKey + ']'
      );
    }
    return true;
  }

  function switchRole(role) {
    const validRoles = Object.values(Models.ROLES);
    if (!validRoles.includes(role)) {
      throw new Error('无效的角色：' + role);
    }
    const user = getDefaultUserForRole(role);
    Storage.setCurrentRole(role);
    if (user) {
      Storage.setCurrentUser(Object.assign({}, user, { role }));
    }
    Audit.log(
      Audit.ACTIONS.ROLE_SWITCH,
      'SYSTEM',
      { from: Storage.getCurrentRole(), to: role, userId: user && user.id },
      'AUDIT'
    );
    return { role, user };
  }

  function getRoleNavItems(role) {
    const perms = getPermissions(role);
    const items = [];
    const pageDefs = {
      order_create: { group: '业务操作', label: '下单小票', icon: '📝', page: 'order_create' },
      order_list: { group: '订单管理', label: '我的订单', icon: '📦', page: 'order_list_student' },
      order_pool: { group: '订单管理', label: '接单面板', icon: '🎯', page: 'order_pool' },
      order_detail: { group: '订单管理', label: '订单详情', icon: '🔍', page: 'order_detail' },
      runner_status: { group: '个人设置', label: '忙碌状态', icon: '⏸️', page: 'runner_busy' },
      my_deliveries: { group: '订单管理', label: '我的配送', icon: '🚴', page: 'my_deliveries' },
      all_orders: { group: '订单管理', label: '全部订单', icon: '📊', page: 'all_orders' },
      runner_management: { group: '人员管理', label: '跑腿员管理', icon: '👥', page: 'runner_mgmt' },
      exception_management: { group: '异常处理', label: '异常管理', icon: '⚠️', page: 'exception_mgmt' },
      coupon_management: { group: '运营管理', label: '优惠券管理', icon: '🎟️', page: 'coupon_mgmt' },
      finance_review: { group: '财务复核', label: '复核列表', icon: '✅', page: 'finance_review' },
      finance_refund: { group: '财务复核', label: '退款审批', icon: '💰', page: 'finance_refund' },
      finance_statistics: { group: '财务复核', label: '统计报表', icon: '📈', page: 'finance_stats' },
      order_detail_mine: { group: '订单管理', label: '订单详情', icon: '🔍', page: 'order_detail_mine' },
      coupon_mine: { group: '个人设置', label: '我的优惠券', icon: '🎟️', page: 'coupon_mine' }
    };
    const groups = {};
    perms.pages.forEach(p => {
      const def = pageDefs[p];
      if (!def) return;
      if (!groups[def.group]) groups[def.group] = [];
      groups[def.group].push(def);
    });
    return groups;
  }

  return {
    ROLE_USERS,
    PERMISSIONS,
    getUsersForRole,
    getDefaultUserForRole,
    getPermissions,
    canAccessPage,
    canDoAction,
    requireRole,
    switchRole,
    getRoleNavItems
  };
})();
