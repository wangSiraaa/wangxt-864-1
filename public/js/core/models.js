const Models = (() => {
  const ORDER_STATUSES = Object.freeze({
    PENDING_PAYMENT: 'pending_payment',
    PENDING_ACCEPT: 'pending_accept',
    ACCEPTED: 'accepted',
    PICKING: 'picking',
    DELIVERING: 'delivering',
    DELIVERED: 'delivered',
    CANCELLED: 'cancelled',
    EXCEPTION: 'exception'
  });

  const STATUS_LABELS = Object.freeze({
    [ORDER_STATUSES.PENDING_PAYMENT]: '待支付',
    [ORDER_STATUSES.PENDING_ACCEPT]: '待接单',
    [ORDER_STATUSES.ACCEPTED]: '已接单',
    [ORDER_STATUSES.PICKING]: '取货中',
    [ORDER_STATUSES.DELIVERING]: '配送中',
    [ORDER_STATUSES.DELIVERED]: '已送达',
    [ORDER_STATUSES.CANCELLED]: '已取消',
    [ORDER_STATUSES.EXCEPTION]: '异常复核'
  });

  const ROLES = Object.freeze({
    STUDENT: 'student',
    RUNNER: 'runner',
    ADMIN: 'admin',
    FINANCE: 'finance'
  });

  const ROLE_LABELS = Object.freeze({
    [ROLES.STUDENT]: '下单学生',
    [ROLES.RUNNER]: '跑腿员',
    [ROLES.ADMIN]: '管理员',
    [ROLES.FINANCE]: '财务复核员'
  });

  const WEIGHT_TIERS = Object.freeze([
    { min: 0, max: 1, fee: 0, label: '0-1kg (免费)' },
    { min: 1, max: 3, fee: 2, label: '1-3kg (+2元)' },
    { min: 3, max: 6, fee: 5, label: '3-6kg (+5元)' },
    { min: 6, max: 10, fee: 10, label: '6-10kg (+10元)' },
    { min: 10, max: Infinity, fee: 18, label: '>10kg (+18元)' }
  ]);

  const DISTANCE_TIERS = Object.freeze([
    { min: 0, max: 0.5, fee: 0, label: '0-500m (免费)' },
    { min: 0.5, max: 1, fee: 1, label: '500m-1km (+1元)' },
    { min: 1, max: 2, fee: 3, label: '1-2km (+3元)' },
    { min: 2, max: 4, fee: 6, label: '2-4km (+6元)' },
    { min: 4, max: Infinity, fee: 10, label: '>4km (+10元)' }
  ]);

  const NIGHT_TIME = Object.freeze({
    start: 22,
    end: 6,
    fee: 3,
    label: '夜间费'
  });

  const CANCEL_RULES = Object.freeze([
    { status: ORDER_STATUSES.PENDING_PAYMENT, penaltyRate: 0, canCancel: true },
    { status: ORDER_STATUSES.PENDING_ACCEPT, penaltyRate: 0, canCancel: true },
    { status: ORDER_STATUSES.ACCEPTED, penaltyRate: 0.2, canCancel: true },
    { status: ORDER_STATUSES.PICKING, penaltyRate: 0.4, canCancel: true },
    { status: ORDER_STATUSES.DELIVERING, penaltyRate: 0.6, canCancel: true },
    { status: ORDER_STATUSES.DELIVERED, penaltyRate: 0, canCancel: false },
    { status: ORDER_STATUSES.CANCELLED, penaltyRate: 0, canCancel: false },
    { status: ORDER_STATUSES.EXCEPTION, penaltyRate: 0, canCancel: false }
  ]);

  const COUPON_TYPES = Object.freeze({
    AMOUNT: 'amount',
    PERCENT: 'percent',
    FREESHIP: 'freeship'
  });

  const COUPON_MUTEX_GROUPS = Object.freeze({
    FULL: ['amount', 'percent', 'freeship'],
    DISCOUNT: ['amount', 'percent']
  });

  function generateId(prefix = '') {
    return prefix + Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
  }

  function generateOrderCode() {
    const now = new Date();
    const date = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0');
    const random = Math.floor(10000 + Math.random() * 90000);
    return `PT${date}${random}`;
  }

  function createOrder(overrides = {}) {
    const now = Date.now();
    return {
      id: generateId('order_'),
      code: generateOrderCode(),
      studentId: overrides.studentId || 'student_demo_1',
      studentName: overrides.studentName || '小明',
      runnerId: null,
      runnerName: null,
      status: ORDER_STATUSES.PENDING_PAYMENT,
      title: overrides.title || '',
      description: overrides.description || '',
      pickupAddress: overrides.pickupAddress || '',
      deliveryAddress: overrides.deliveryAddress || '',
      pickupContact: overrides.pickupContact || '',
      deliveryContact: overrides.deliveryContact || '',
      weightKg: overrides.weightKg || 0,
      distanceKm: overrides.distanceKm || 0,
      isNight: overrides.isNight || false,
      overWeightConfirmed: false,
      couponId: overrides.couponId || null,
      feeDetail: null,
      totalAmount: 0,
      payAmount: 0,
      cancelReason: null,
      cancelledAt: null,
      cancelledBy: null,
      penaltyAmount: 0,
      exceptionNote: null,
      exceptionHistory: [],
      financeReviewed: false,
      financeRefundApproved: false,
      financeReviewNote: null,
      statusHistory: [],
      deliveryNodes: [],
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      acceptedAt: null,
      pickedAt: null,
      deliveredAt: null,
      ...overrides
    };
  }

  function createRunner(overrides = {}) {
    return {
      id: overrides.id || generateId('runner_'),
      name: overrides.name || '跑腿员',
      isBusy: overrides.isBusy || false,
      busyReason: overrides.busyReason || null,
      busySince: overrides.isBusy ? Date.now() : null,
      ordersCompleted: overrides.ordersCompleted || 0,
      rating: overrides.rating || 5.0,
      createdAt: overrides.createdAt || Date.now(),
      ...overrides
    };
  }

  function createCoupon(overrides = {}) {
    return {
      id: overrides.id || generateId('coupon_'),
      code: overrides.code || ('CPN' + Math.floor(100000 + Math.random() * 900000)),
      type: overrides.type || COUPON_TYPES.AMOUNT,
      value: overrides.value || 5,
      mutexGroup: overrides.mutexGroup || 'FULL',
      minAmount: overrides.minAmount || 0,
      name: overrides.name || '优惠券',
      validFrom: overrides.validFrom || Date.now(),
      validUntil: overrides.validUntil || Date.now() + 86400000 * 30,
      used: false,
      ...overrides
    };
  }

  function createFeeDetail() {
    return {
      baseFee: { name: '基础配送费', amount: 0, description: '基础服务费' },
      weightFee: { name: '重量阶梯费', amount: 0, description: '', tier: null },
      distanceFee: { name: '距离附加费', amount: 0, description: '', tier: null },
      nightFee: { name: '夜间附加费', amount: 0, description: '', enabled: false },
      couponDiscount: { name: '优惠券抵扣', amount: 0, description: '', couponId: null },
      originalTotal: 0,
      finalTotal: 0
    };
  }

  function createAuditLog(action, actor, target, data = {}, level = 'INFO') {
    return {
      id: generateId('audit_'),
      timestamp: Date.now(),
      action,
      actor,
      actorRole: null,
      target,
      data,
      level,
      sessionId: localStorage.getItem('sessionId') || 'unknown'
    };
  }

  return {
    ORDER_STATUSES,
    STATUS_LABELS,
    ROLES,
    ROLE_LABELS,
    WEIGHT_TIERS,
    DISTANCE_TIERS,
    NIGHT_TIME,
    CANCEL_RULES,
    COUPON_TYPES,
    COUPON_MUTEX_GROUPS,
    generateId,
    generateOrderCode,
    createOrder,
    createRunner,
    createCoupon,
    createFeeDetail,
    createAuditLog
  };
})();
