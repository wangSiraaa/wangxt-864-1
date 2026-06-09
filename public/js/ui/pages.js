const Pages = (() => {
  let _seeded = false;

  async function seedTestData() {
    if (_seeded) return;
    await DB.open();
    const rc = await DB.getCount(DB.STORES.runners);
    if (rc === 0) await DB.putMany(DB.STORES.runners, [
      Models.createRunner({ id: 'runner_demo_1', name: '跑腿员_阿强', ordersCompleted: 128, rating: 4.9 }),
      Models.createRunner({ id: 'runner_demo_2', name: '跑腿员_阿杰', ordersCompleted: 96, rating: 4.8 }),
      Models.createRunner({ id: 'runner_demo_3', name: '跑腿员_小美', ordersCompleted: 73, rating: 4.7 })
    ]);
    const cc = await DB.getCount(DB.STORES.coupons);
    if (cc === 0) await DB.putMany(DB.STORES.coupons, [
      Models.createCoupon({ code: 'CPN888801', name: '新人5元券', type: Models.COUPON_TYPES.AMOUNT, value: 5, minAmount: 10, mutexGroup: 'FULL' }),
      Models.createCoupon({ code: 'CPN888802', name: '8折优惠券', type: Models.COUPON_TYPES.PERCENT, value: 20, minAmount: 15, mutexGroup: 'DISCOUNT' }),
      Models.createCoupon({ code: 'CPN888803', name: '免基础费', type: Models.COUPON_TYPES.FREESHIP, mutexGroup: 'FULL' })
    ]);
    const oc = await DB.getCount(DB.STORES.orders);
    if (oc === 0) {
      const st = Object.values(Models.ORDER_STATUSES);
      const titles = ['取快递-菜鸟驿站', '代买奶茶', '取外卖', '代打印', '京东自提点', '代买水果'];
      const addrs = ['菜鸟驿站', '京东自提点', '校门口蜜雪', '文印店', '南区超市'];
      const deliv = ['宿舍1号楼302', '宿舍2号楼506', '宿舍3号楼208', '教学楼B501'];
      const orders = [];
      for (let i = 0; i < 8; i++) {
        const w = [0.5, 1.5, 3.5, 5, 7, 11][i % 6];
        const d = [0.3, 0.8, 1.5, 2.5, 3.5, 5][i % 6];
        const o = Models.createOrder({
          title: titles[i % titles.length],
          description: '放门口就行',
          pickupAddress: addrs[i % 5],
          deliveryAddress: deliv[i % 4],
          pickupContact: '138****' + (1000 + i),
          deliveryContact: '139****' + (2000 + i),
          weightKg: w, distanceKm: d, isNight: i % 3 === 0,
          status: st[i], statusHistory: []
        });
        const fd = FeeEngine.calculate(o);
        o.feeDetail = fd; o.totalAmount = fd.finalTotal;
        o.payAmount = fd.overweight && fd.overweight.required ? fd.overweightTotal : fd.finalTotal;
        if (i >= 1) { o.paidAt = o.createdAt + 60000; o.statusHistory.push({ from: Models.ORDER_STATUSES.PENDING_PAYMENT, to: Models.ORDER_STATUSES.PENDING_ACCEPT, timestamp: o.paidAt, actor: 'student_demo_1', actorName: '小明', actorRole: Models.ROLES.STUDENT }); }
        if (i >= 2 && o.status !== Models.ORDER_STATUSES.PENDING_ACCEPT) {
          o.runnerId = 'runner_demo_' + ((i % 3) + 1);
          o.runnerName = '跑腿员_' + ['阿强', '阿杰', '小美'][i % 3];
          o.acceptedAt = o.paidAt + 120000;
          o.statusHistory.push({ from: Models.ORDER_STATUSES.PENDING_ACCEPT, to: Models.ORDER_STATUSES.ACCEPTED, timestamp: o.acceptedAt, actor: o.runnerId, actorName: o.runnerName, actorRole: Models.ROLES.RUNNER });
        }
        if (i === 7) { o.exceptionNote = '收件人联系不上'; o.exceptionHistory = [{ version: 1, note: o.exceptionNote, timestamp: Date.now(), actor: o.runnerId }]; }
        if (i === 6) {
          o.cancelReason = '临时不需要了'; o.penaltyAmount = 0;
          o.cancelledBy = 'student_demo_1'; o.cancelledAt = o.acceptedAt + 300000;
          o.statusHistory.push({ from: Models.ORDER_STATUSES.ACCEPTED, to: Models.ORDER_STATUSES.CANCELLED, timestamp: o.cancelledAt, actor: 'student_demo_1', actorName: '小明', actorRole: Models.ROLES.STUDENT, note: o.cancelReason });
        }
        orders.push(o);
      }
      await DB.putMany(DB.STORES.orders, orders);
    }
    _seeded = true;
  }

  async function stats() {
    await DB.open(); await seedTestData();
    const orders = await DB.getAll(DB.STORES.orders);
    const today = new Date(); today.setHours(0, 0, 0, 0); const ts = today.getTime();
    return {
      total: orders.length, today: orders.filter(o => o.createdAt >= ts).length,
      pending: orders.filter(o => o.status === Models.ORDER_STATUSES.PENDING_ACCEPT).length,
      delivering: orders.filter(o => [Models.ORDER_STATUSES.ACCEPTED, Models.ORDER_STATUSES.PICKING, Models.ORDER_STATUSES.DELIVERING].includes(o.status)).length,
      delivered: orders.filter(o => o.status === Models.ORDER_STATUSES.DELIVERED).length,
      exception: orders.filter(o => o.status === Models.ORDER_STATUSES.EXCEPTION).length,
      cancelled: orders.filter(o => o.status === Models.ORDER_STATUSES.CANCELLED).length,
      revenue: orders.filter(o => o.status === Models.ORDER_STATUSES.DELIVERED).reduce((s, o) => s + (o.payAmount || 0), 0)
    };
  }

  function statsCards(s, role) {
    const items = [
      { cls: 'total', icon: '📦', label: '订单总数', v: s.total },
      { cls: 'today', icon: '📅', label: '今日订单', v: s.today }
    ];
    if (role === Models.ROLES.RUNNER) {
      items.push({ cls: 'waiting', icon: '🎯', label: '待接单', v: s.pending });
      items.push({ cls: 'busy', icon: '🚴', label: '配送中', v: s.delivering });
    } else if (role === Models.ROLES.STUDENT) {
      items.push({ cls: 'success', icon: '✅', label: '已完成', v: s.delivered });
      items.push({ cls: 'fail', icon: '❌', label: '已取消', v: s.cancelled });
    } else {
      items.push({ cls: 'busy', icon: '🚴', label: '进行中', v: s.delivering });
      items.push({ cls: 'fail', icon: '⚠️', label: '异常', v: s.exception });
    }
    return items.map(it => '<div class="stat-card ' + it.cls + '"><div class="stat-label">' + it.icon + ' ' + it.label + '</div><div class="stat-value">' + it.v + '</div></div>').join('');
  }

  async function listOrders(filters) {
    await DB.open(); await seedTestData();
    let orders = await DB.getAll(DB.STORES.orders);
    const f = filters || {};
    if (f.status && f.status !== 'all') orders = orders.filter(o => o.status === f.status);
    if (f.studentId) orders = orders.filter(o => o.studentId === f.studentId);
    if (f.runnerId) orders = orders.filter(o => o.runnerId === f.runnerId);
    if (f.keyword) { const k = f.keyword.toLowerCase(); orders = orders.filter(o => (o.code||'').toLowerCase().includes(k) || (o.title||'').toLowerCase().includes(k) || (o.pickupAddress||'').toLowerCase().includes(k) || (o.deliveryAddress||'').toLowerCase().includes(k)); }
    orders.sort((a, b) => b.createdAt - a.createdAt);
    return orders;
  }

  function orderRow(o, pageKey) {
    const user = Storage.getCurrentUser();
    const userId = user.id;
    const isCandidate = Storage.isCompareCandidate(userId, o.id);
    const enableCompare = pageKey === 'order_list_student';
    let firstCol = '';
    if (enableCompare) {
      firstCol = '<td class="compare-checkbox-col"><label class="compare-checkbox-label">' +
        '<input type="checkbox" class="compare-checkbox" data-order-id="' + o.id + '" ' + (isCandidate ? 'checked' : '') + '>' +
        '<span class="compare-checkmark"></span></label></td>';
    }
    return '<tr data-order-id="' + o.id + '" class="' + (enableCompare && isCandidate ? 'compare-selected' : '') + '">' +
      firstCol +
      '<td><div class="font-bold">' + o.code + '</div><div class="text-sm text-muted">' + UI.formatTime(o.createdAt) + '</div></td>' +
      '<td>' + (o.title || '') + '</td>' +
      '<td>' + (o.pickupAddress || '-') + '<br><span class="text-muted">→</span> ' + (o.deliveryAddress || '-') + '</td>' +
      '<td><span class="tag tag-weight">' + o.weightKg + 'kg</span> ' + (o.isNight ? '<span class="tag tag-night">夜间</span> ' : '') + o.distanceKm + 'km</td>' +
      '<td class="font-mono font-bold text-primary">' + UI.formatMoney(o.payAmount || 0) + '</td>' +
      '<td>' + UI.statusBadge(o.status) + '</td>' +
      '<td>' + (o.runnerName ? o.runnerName : '<span class="text-muted">-</span>') + '</td>' +
      '<td><button class="btn btn-sm btn-outline" data-action="view">详情</button></td></tr>';
  }

  function orderTable(orders, pageKey) {
    const saved = Storage.getLastFilters(pageKey || 'orders');
    const f = Object.assign({ status: 'all', keyword: '' }, saved);
    const statusOpts = Object.keys(Models.STATUS_LABELS).map(k =>
      '<option value="' + k + '" ' + (f.status === k ? 'selected' : '') + '>' + Models.STATUS_LABELS[k] + '</option>').join('');
    const enableCompare = pageKey === 'order_list_student';
    const user = Storage.getCurrentUser();
    const userId = user.id;
    const candidates = Storage.getCompareCandidates(userId);
    const candidateIds = new Set(candidates);
    const selectedCount = orders.filter(o => candidateIds.has(o.id)).length;
    let html = '<div class="filter-bar">' +
      '<div class="filter-group"><label>关键字</label><input type="text" id="fl_keyword" placeholder="订单号/标题/地址" value="' + UI.escapeHtml(f.keyword || '') + '"></div>' +
      '<div class="filter-group"><label>状态</label><select id="fl_status"><option value="all">全部</option>' + statusOpts + '</select></div>' +
      '<div class="flex" style="align-items:flex-end;gap:8px"><button class="btn btn-primary btn-sm" id="fl_search">🔍 查询</button><button class="btn btn-ghost btn-sm" id="fl_reset">重置</button></div></div>';
    if (enableCompare) {
      html += '<div class="compare-action-bar" id="compareActionBar">' +
        '<div class="compare-info">' +
          '<label class="compare-all-label">' +
            '<input type="checkbox" id="compareSelectAll" ' + (orders.length > 0 && selectedCount === orders.length ? 'checked' : '') + '>' +
            '<span>全选本页</span>' +
          '</label>' +
          '<span class="compare-selected-info">已选 <b id="compareSelectedCount">' + candidates.length + '</b> 个订单' + (selectedCount !== candidates.length ? '（本页 ' + selectedCount + ' 个）' : '') + '</span>' +
        '</div>' +
        '<div class="compare-actions">' +
          '<button class="btn btn-outline btn-sm" id="compareClearBtn">清空选择</button>' +
          '<button class="btn btn-primary btn-sm" id="compareStartBtn" ' + (candidates.length < 2 ? 'disabled' : '') + '>⚖️ 候选对比 (' + candidates.length + ')</button>' +
        '</div>' +
      '</div>';
    }
    let colSpan = 8;
    let headerRow = '<th>订单号/时间</th><th>标题</th><th>配送地址</th><th>规格</th><th>金额</th><th>状态</th><th>跑腿员</th><th>操作</th>';
    if (enableCompare) {
      colSpan = 9;
      headerRow = '<th class="compare-checkbox-col"><label class="compare-checkbox-label">' +
        '<input type="checkbox" id="compareSelectAllHeader" ' + (orders.length > 0 && selectedCount === orders.length ? 'checked' : '') + '>' +
        '<span class="compare-checkmark"></span></label></th>' + headerRow;
    }
    html += '<div class="card"><div class="card-body"><div class="table-wrapper"><table class="data-table"><thead><tr>' +
      headerRow +
      '</tr></thead><tbody>';
    if (orders.length === 0) html += '<tr><td colspan="' + colSpan + '"><div class="empty-state"><div class="icon">📭</div><div class="text">暂无订单</div></div></td></tr>';
    else html += orders.map(o => orderRow(o, pageKey)).join('');
    html += '</tbody></table></div></div></div>';
    if (enableCompare && candidates.length > 0) {
      html += '<div class="compare-float-bar" id="compareFloatBar">' +
        '<div class="compare-float-info">📋 已选择 <b>' + candidates.length + '</b> 个订单进行候选对比</div>' +
        '<div class="compare-float-actions">' +
          '<button class="btn btn-sm btn-outline" id="compareFloatClear">清空</button>' +
          '<button class="btn btn-sm btn-primary" id="compareFloatStart">⚖️ 开始对比</button>' +
        '</div>' +
      '</div>';
    }
    return html;
  }

  function showCompareModal(userId) {
    const candidateIds = Storage.getCompareCandidates(userId);
    if (candidateIds.length < 2) {
      UI.showToast('无法对比', '请至少选择2个订单进行对比', 'warning');
      return;
    }
    DB.open().then(() => {
      return Promise.all(candidateIds.map(id => DB.get(DB.STORES.orders, id)));
    }).then(orders => {
      const validOrders = orders.filter(o => o);
      if (validOrders.length < 2) {
        UI.showToast('无法对比', '有效订单不足2个', 'warning');
        return;
      }
      Audit.log(Audit.ACTIONS.ORDER_COMPARE, userId, { orderIds: candidateIds, count: validOrders.length }, 'AUDIT');
      const modal = UI.openModal(UI.orderCompareTable(validOrders), {
        title: '⚖️ 订单候选对比',
        size: 'large',
        footerHtml: '<div style="display:flex;gap:8px;justify-content:space-between;align-items:center">' +
          '<div class="text-sm text-muted">提示：横向滚动查看更多字段</div>' +
          '<button class="btn btn-outline" data-action="compare-clear">清空候选</button>' +
          '<button class="btn btn-primary" data-action="close-modal">关闭</button></div>'
      });
      if (modal && modal.el) {
        const clearBtn = modal.el.querySelector('[data-action="compare-clear"]');
        if (clearBtn) clearBtn.addEventListener('click', () => {
          Storage.clearCompareCandidates(userId);
          UI.showToast('已清空', '候选对比已清空', 'success');
          modal.close();
          const currentPage = App.currentPage || 'order_list_student';
          App.renderPage(currentPage);
        });
      }
    }).catch(e => {
      UI.showToast('加载失败', e.message || String(e), 'error');
    });
  }

  function updateCompareUI(page, user, orderIdsOnPage) {
    const userId = user.id;
    const candidates = Storage.getCompareCandidates(userId);
    const candidateSet = new Set(candidates);
    const countEl = document.getElementById('compareSelectedCount');
    if (countEl) countEl.textContent = candidates.length;
    const startBtn = document.getElementById('compareStartBtn');
    if (startBtn) {
      startBtn.disabled = candidates.length < 2;
      startBtn.textContent = '⚖️ 候选对比 (' + candidates.length + ')';
    }
    const floatBar = document.getElementById('compareFloatBar');
    if (floatBar) {
      const floatInfo = floatBar.querySelector('.compare-float-info b');
      if (floatInfo) floatInfo.textContent = candidates.length;
      floatBar.style.display = candidates.length > 0 ? 'flex' : 'none';
    }
    const selectAll1 = document.getElementById('compareSelectAll');
    const selectAll2 = document.getElementById('compareSelectAllHeader');
    if (orderIdsOnPage && orderIdsOnPage.length > 0) {
      const pageSelected = orderIdsOnPage.filter(id => candidateSet.has(id)).length;
      const allChecked = pageSelected === orderIdsOnPage.length;
      if (selectAll1) selectAll1.checked = allChecked;
      if (selectAll2) selectAll2.checked = allChecked;
    }
    document.querySelectorAll('tr[data-order-id]').forEach(tr => {
      const id = tr.getAttribute('data-order-id');
      const isSelected = candidateSet.has(id);
      tr.classList.toggle('compare-selected', isSelected);
      const cb = tr.querySelector('.compare-checkbox');
      if (cb) cb.checked = isSelected;
    });
    const selInfo = document.querySelector('.compare-selected-info');
    if (selInfo && orderIdsOnPage) {
      const pageSelected = orderIdsOnPage.filter(id => candidateSet.has(id)).length;
      selInfo.innerHTML = '已选 <b>' + candidates.length + '</b> 个订单' + (pageSelected !== candidates.length ? '（本页 ' + pageSelected + ' 个）' : '');
    }
  }

  function bindOrderTable(page) {
    const save = () => {
      Storage.setLastFilters(page, {
        keyword: (document.getElementById('fl_keyword') || {}).value || '',
        status: (document.getElementById('fl_status') || {}).value || 'all'
      });
    };
    const s = document.getElementById('fl_search');
    const r = document.getElementById('fl_reset');
    const k = document.getElementById('fl_keyword');
    if (s) s.addEventListener('click', () => { save(); App.renderPage(page); });
    if (r) r.addEventListener('click', () => { Storage.setLastFilters(page, {}); App.renderPage(page); });
    if (k) k.addEventListener('keydown', e => { if (e.key === 'Enter') { save(); App.renderPage(page); } });
    document.querySelectorAll('tr[data-order-id]').forEach(tr => {
      const id = tr.getAttribute('data-order-id');
      tr.querySelectorAll('[data-action="view"]').forEach(b => b.addEventListener('click', () => App.renderPage('order_detail', { id })));
    });

    const enableCompare = page === 'order_list_student';
    if (!enableCompare) return;

    const user = Storage.getCurrentUser();
    const userId = user.id;
    const orderIdsOnPage = Array.from(document.querySelectorAll('tr[data-order-id]')).map(tr => tr.getAttribute('data-order-id')).filter(Boolean);

    document.querySelectorAll('.compare-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = cb.getAttribute('data-order-id');
        if (!id) return;
        if (cb.checked) {
          Storage.addCompareCandidate(userId, id);
        } else {
          Storage.removeCompareCandidate(userId, id);
        }
        updateCompareUI(page, user, orderIdsOnPage);
      });
    });

    const selectAllHandler = (chkEl) => {
      if (!chkEl) return;
      chkEl.addEventListener('change', () => {
        const shouldSelect = chkEl.checked;
        if (shouldSelect) {
          orderIdsOnPage.forEach(id => Storage.addCompareCandidate(userId, id));
        } else {
          orderIdsOnPage.forEach(id => Storage.removeCompareCandidate(userId, id));
        }
        updateCompareUI(page, user, orderIdsOnPage);
      });
    };
    selectAllHandler(document.getElementById('compareSelectAll'));
    selectAllHandler(document.getElementById('compareSelectAllHeader'));

    const clearBtn = document.getElementById('compareClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      Storage.clearCompareCandidates(userId);
      UI.showToast('已清空', '候选对比已清空', 'success');
      updateCompareUI(page, user, orderIdsOnPage);
    });

    const startCompare = () => showCompareModal(userId);
    const startBtn = document.getElementById('compareStartBtn');
    if (startBtn) startBtn.addEventListener('click', startCompare);
    const floatStart = document.getElementById('compareFloatStart');
    if (floatStart) floatStart.addEventListener('click', startCompare);
    const floatClear = document.getElementById('compareFloatClear');
    if (floatClear) floatClear.addEventListener('click', () => {
      Storage.clearCompareCandidates(userId);
      UI.showToast('已清空', '候选对比已清空', 'success');
      updateCompareUI(page, user, orderIdsOnPage);
    });
  }

  async function pageOrderCreate() {
    await seedTestData();
    const coupons = (await DB.getAll(DB.STORES.coupons)).filter(c => !c.used && c.validFrom <= Date.now() && c.validUntil >= Date.now());
    const f = Storage.getLastFilters('order_create', { title: '', description: '', pickupAddress: '', deliveryAddress: '', weightKg: 0, distanceKm: 0, isNight: FeeEngine.isNightTime(), couponId: '', pickupContact: '', deliveryContact: '' });
    const couponOpts = '<option value="">不使用优惠券</option>' + coupons.map(c =>
      '<option value="' + c.id + '" ' + (f.couponId === c.id ? 'selected' : '') + '>' + c.code + '-' + c.name +
      '(' + (c.type === Models.COUPON_TYPES.AMOUNT ? '减' + c.value + '元' : c.type === Models.COUPON_TYPES.PERCENT ? (100 - c.value) / 10 + '折' : '免基础费') + ',满' + c.minAmount + '元)' +
      '</option>').join('');
    let h = '<div class="page-header"><div><h2 class="page-title">📝 下单小票</h2><div class="text-muted text-sm">系统自动计算费用</div></div></div>';
    h += '<div class="card"><div class="card-header"><div class="card-title">订单信息</div></div><div class="card-body">';
    h += '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">标题<span class="required">*</span></label><input class="form-input" id="f_title" value="' + UI.escapeHtml(f.title || '') + '" placeholder="取快递/代买..."></div>' +
      '<div class="form-group"><label class="form-label">取件联系人<span class="required">*</span></label><input class="form-input" id="f_pickupContact" value="' + UI.escapeHtml(f.pickupContact || '') + '"></div></div>';
    h += '<div class="form-row full"><div class="form-group"><label class="form-label">备注</label><textarea class="form-textarea" id="f_description" maxlength="200">' + UI.escapeHtml(f.description || '') + '</textarea></div></div>';
    h += '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">取货地址<span class="required">*</span></label><input class="form-input" id="f_pickupAddress" value="' + UI.escapeHtml(f.pickupAddress || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">送达地址<span class="required">*</span></label><input class="form-input" id="f_deliveryAddress" value="' + UI.escapeHtml(f.deliveryAddress || '') + '"></div></div>';
    h += '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">收件人联系<span class="required">*</span></label><input class="form-input" id="f_deliveryContact" value="' + UI.escapeHtml(f.deliveryContact || '') + '"></div>' +
      '<div class="form-group"><label class="form-label">优惠券</label><select class="form-select" id="f_couponId">' + couponOpts + '</select></div></div>';
    h += '<div class="form-row">' +
      '<div class="form-group"><label class="form-label">重量(kg)<span class="required">*</span></label><input class="form-input" type="number" min="0" step="0.1" id="f_weightKg" value="' + (f.weightKg || 0) + '"><div class="form-hint">超过3kg收超重费</div></div>' +
      '<div class="form-group"><label class="form-label">距离(km)<span class="required">*</span></label><input class="form-input" type="number" min="0" step="0.1" id="f_distanceKm" value="' + (f.distanceKm || 0) + '"></div></div>';
    h += '<div class="checkbox-row"><input type="checkbox" id="f_isNight" ' + (f.isNight ? 'checked' : '') + '><label for="f_isNight">夜间配送（22:00-06:00 +' + Models.NIGHT_TIME.fee + '元）</label></div>';
    h += '</div></div>';
    h += '<div class="card"><div class="card-header"><div class="card-title">💰 费用明细 <button class="btn btn-ghost btn-sm" id="recalcBtn">🔄 重新计算</button></div></div><div class="card-body">';
    h += '<div id="feeBreakdownContainer">' + UI.loadingHtml('正在计算...') + '</div>';
    h += '<div id="overweightBanner"></div>';
    h += '</div></div>';
    h += '<div class="flex-between mt-md"><button class="btn btn-ghost" id="saveDraftBtn">💾 暂存草稿</button>' +
      '<div class="flex gap-md"><button class="btn btn-outline" id="clearFormBtn">清空</button>' +
      '<button class="btn btn-primary btn-lg" id="submitOrderBtn">✅ 提交并支付</button></div></div>';
    return h;
  }

  function readForm() {
    const g = id => (document.getElementById(id) || {}).value || '';
    const gc = id => !!(document.getElementById(id) || {}).checked;
    const gn = id => parseFloat((document.getElementById(id) || {}).value || 0) || 0;
    return { title: g('f_title'), description: g('f_description'), pickupAddress: g('f_pickupAddress'), deliveryAddress: g('f_deliveryAddress'), pickupContact: g('f_pickupContact'), deliveryContact: g('f_deliveryContact'), weightKg: gn('f_weightKg'), distanceKm: gn('f_distanceKm'), isNight: gc('f_isNight'), couponId: g('f_couponId') };
  }

  async function updateFee() {
    const data = readForm();
    const coupons = await DB.getAll(DB.STORES.coupons);
    data.coupon = coupons.find(c => c.id === data.couponId) || null;
    const detail = FeeEngine.calculate(data);
    const cont = document.getElementById('feeBreakdownContainer');
    if (cont) cont.innerHTML = UI.feeBreakdown(detail);
    const banner = document.getElementById('overweightBanner');
    if (banner) {
      if (detail.overweight && detail.overweight.required) {
        const confirmed = !!(document.getElementById('overweightConfirmChk') || {}).checked;
        banner.innerHTML = '<div class="warning-banner"><div class="icon">⚠️</div><div class="content">' +
          '<div class="title">超重订单加价提示</div><div class="desc">' + (detail.overweight.description || '') + '</div>' +
          '<div class="actions"><label class="checkbox-row" style="padding:0"><input type="checkbox" id="overweightConfirmChk" ' + (confirmed ? 'checked' : '') + '>' +
          '<span>我已确认超重附加费 ¥' + detail.overweight.additionalFee.toFixed(2) + '</span></label></div></div></div>';
        const chk = document.getElementById('overweightConfirmChk');
        if (chk) chk.addEventListener('change', () => Storage.setLastFilters('order_create', readForm()));
      } else banner.innerHTML = '';
    }
    return detail;
  }

  function bindOrderCreate() {
    ['f_title', 'f_description', 'f_pickupAddress', 'f_deliveryAddress', 'f_pickupContact', 'f_deliveryContact'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => Storage.setLastFilters('order_create', readForm()));
    });
    ['f_weightKg', 'f_distanceKm', 'f_isNight', 'f_couponId'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => { Storage.setLastFilters('order_create', readForm()); updateFee(); });
    });
    const recalc = document.getElementById('recalcBtn');
    if (recalc) recalc.addEventListener('click', async () => { const d = await updateFee(); UI.showToast('已重算', '金额：' + UI.formatMoney(d.overweight && d.overweight.required ? d.overweightTotal : d.finalTotal), 'success'); await Audit.log(Audit.ACTIONS.FEE_RECALCULATE, 'DRAFT', {}); });
    const clear = document.getElementById('clearFormBtn');
    if (clear) clear.addEventListener('click', () => { Storage.setLastFilters('order_create', {}); App.renderPage('order_create'); });
    const draft = document.getElementById('saveDraftBtn');
    if (draft) draft.addEventListener('click', () => { Storage.setLastFilters('order_create', readForm()); UI.showToast('已保存草稿', '', 'success'); });
    const submit = document.getElementById('submitOrderBtn');
    if (submit) submit.addEventListener('click', async () => {
      const data = readForm();
      if (!data.title || !data.pickupAddress || !data.deliveryAddress || !data.pickupContact || !data.deliveryContact) {
        UI.showToast('提交失败', '请填写完整信息', 'error'); return;
      }
      const owChk = document.getElementById('overweightConfirmChk');
      const coupons = await DB.getAll(DB.STORES.coupons);
      data.coupon = coupons.find(c => c.id === data.couponId) || null;
      const detail = FeeEngine.calculate(data);
      if (detail.overweight && detail.overweight.required && !(owChk && owChk.checked)) {
        UI.showToast('未确认超重加价', '超重订单需先确认加价条款', 'warning'); return;
      }
      data.overWeightConfirmed = !!(detail.overweight && detail.overweight.required);
      const user = Storage.getCurrentUser();
      const order = Models.createOrder(Object.assign({}, data, { studentId: user.id, studentName: user.name }));
      order.feeDetail = detail; order.totalAmount = detail.finalTotal;
      order.payAmount = detail.overweight && detail.overweight.required ? detail.overweightTotal : detail.finalTotal;
      order.overWeightConfirmed = data.overWeightConfirmed;
      if (data.coupon && data.coupon.id) {
        order.couponId = data.coupon.id;
        const idx = coupons.findIndex(c => c.id === data.coupon.id);
        if (idx >= 0) { coupons[idx].used = true; await DB.put(DB.STORES.coupons, coupons[idx]); }
        await Audit.log(Audit.ACTIONS.COUPON_USE, order.id, { couponId: data.coupon.id });
      }
      if (order.overWeightConfirmed) await Audit.log(Audit.ACTIONS.OVERWEIGHT_CONFIRM, order.id, { weightKg: order.weightKg, additionalFee: detail.overweight.additionalFee }, 'AUDIT');
      await FeeEngine.validateAndSaveCalculation(order.id, detail);
      await DB.open(); await DB.put(DB.STORES.orders, order);
      await Audit.log(Audit.ACTIONS.ORDER_CREATE, order.id, { code: order.code, title: order.title, payAmount: order.payAmount }, 'AUDIT');
      await Audit.log(Audit.ACTIONS.ORDER_PAY, order.id, { amount: order.payAmount }, 'INFO');
      const tr = await StateMachine.transition(order, Models.ORDER_STATUSES.PENDING_ACCEPT, Object.assign({}, user, { role: Storage.getCurrentRole() }), '支付成功');
      await DB.put(DB.STORES.orders, tr.order);
      Storage.setLastFilters('order_create', {});
      Concurrency.resetIdempotentCache();
      UI.showToast('下单成功', '订单号：' + order.code, 'success');
      setTimeout(() => App.renderPage('order_list_student'), 1200);
    });
    setTimeout(updateFee, 100);
  }

  async function pageStudentList() {
    const u = Storage.getCurrentUser(); const s = await stats();
    const f = Storage.getLastFilters('order_list_student');
    const orders = await listOrders(Object.assign({}, f, { studentId: u.id }));
    return '<div class="page-header"><h2 class="page-title">📦 我的订单</h2>' +
      '<div class="page-actions"><button class="btn btn-primary" id="goCreateBtn">📝 立即下单</button></div></div>' +
      '<div class="order-stats">' + statsCards(s, Models.ROLES.STUDENT) + '</div>' + orderTable(orders, 'order_list_student');
  }

  function bindStudentList() {
    bindOrderTable('order_list_student');
    const b = document.getElementById('goCreateBtn');
    if (b) b.addEventListener('click', () => App.renderPage('order_create'));
  }

  async function pageOrderPool() {
    const s = await stats(); const u = Storage.getCurrentUser();
    const runners = await DB.getAll(DB.STORES.runners);
    const me = runners.find(r => r.id === u.id) || { isBusy: false };
    const f = Storage.getLastFilters('order_pool');
    const orders = await listOrders(Object.assign({}, f, { status: Models.ORDER_STATUSES.PENDING_ACCEPT }));
    const busyState = Storage.getRunnerBusyState(u.id) || {};
    const isBusy = me.isBusy || busyState.isBusy;
    let h = '<div class="page-header"><h2 class="page-title">🎯 接单面板</h2>' +
      '<div class="page-actions"><span class="busy-indicator ' + (isBusy ? '' : 'off') + '">' + (isBusy ? '忙碌中' : '空闲') + '</span>' +
      '<button class="btn ' + (isBusy ? 'btn-success' : 'btn-warning') + '" id="toggleBusyBtn">' + (isBusy ? '设为空闲' : '设为忙碌') + '</button></div></div>';
    h += '<div class="order-stats">' + statsCards(s, Models.ROLES.RUNNER) + '</div>';
    if (isBusy) h += '<div class="warning-banner"><div class="icon">⏸️</div><div class="content"><div class="title">当前忙碌</div><div class="desc">忙碌期间将阻止接单</div></div></div>';
    h += orderTable(orders, 'order_pool');
    return h;
  }

  function bindOrderPool() {
    bindOrderTable('order_pool');
    const u = Storage.getCurrentUser();
    const refresh = () => App.renderPage('order_pool');
    const toggle = document.getElementById('toggleBusyBtn');
    if (toggle) toggle.addEventListener('click', async () => {
      const st = Storage.getRunnerBusyState(u.id) || {};
      const nb = !st.isBusy;
      Storage.setRunnerBusyState(u.id, { isBusy: nb, reason: nb ? '手动设置' : null });
      const runners = await DB.getAll(DB.STORES.runners);
      const me = runners.find(r => r.id === u.id);
      if (me) { me.isBusy = nb; me.busySince = nb ? Date.now() : null; await DB.put(DB.STORES.runners, me); }
      await Audit.log(nb ? Audit.ACTIONS.RUNNER_BUSY_SET : Audit.ACTIONS.RUNNER_BUSY_CLEAR, u.id, {}, 'AUDIT');
      UI.showToast('状态已更新', nb ? '忙碌中' : '空闲', 'success');
      setTimeout(refresh, 300);
    });
    document.querySelectorAll('tr[data-order-id]').forEach(tr => {
      const id = tr.getAttribute('data-order-id');
      tr.querySelectorAll('[data-action="view"]').forEach(b => {
        b.textContent = '接单'; b.classList.remove('btn-outline'); b.classList.add('btn-primary');
        b.addEventListener('click', async (e) => {
          e.stopPropagation();
          const busy = Storage.getRunnerBusyState(u.id);
          if (busy && busy.isBusy) { UI.showToast('接单被阻止', '您为忙碌状态', 'error'); return; }
          const order = await DB.get(DB.STORES.orders, id);
          if (order && order.status !== Models.ORDER_STATUSES.PENDING_ACCEPT) { UI.showToast('接单被阻止', '订单状态非待接单', 'error'); refresh(); return; }
          if (order && order.feeDetail && order.feeDetail.overweight && order.feeDetail.overweight.required && !order.overWeightConfirmed) { UI.showToast('接单被阻止', '超重费用未确认', 'error'); return; }
          b.disabled = true; b.textContent = '抢单中...';
          const r = await Concurrency.atomicAcceptOrder(id, { id: u.id, name: u.name });
          if (r.success) { UI.showToast('🎉 抢单成功', '', 'success'); setTimeout(refresh, 600); }
          else { UI.showToast('抢单失败', r.message || '重试', r.reason === 'ALREADY_TAKEN' ? 'warning' : 'error'); b.disabled = false; b.textContent = '接单'; setTimeout(refresh, 400); }
        });
      });
    });
  }

  async function pageOrderDetail(params) {
    await DB.open(); const id = (params || {}).id;
    const order = await DB.get(DB.STORES.orders, id);
    if (!order) return '<div class="empty-state"><div class="icon">❓</div><div class="text">订单不存在</div></div>';
    const role = Storage.getCurrentRole(); const u = Storage.getCurrentUser();
    const actor = Object.assign({}, u, { role });
    let actions = '';
    if (role === Models.ROLES.STUDENT && order.studentId === u.id) {
      if ([Models.ORDER_STATUSES.PENDING_PAYMENT, Models.ORDER_STATUSES.PENDING_ACCEPT, Models.ORDER_STATUSES.ACCEPTED, Models.ORDER_STATUSES.PICKING, Models.ORDER_STATUSES.DELIVERING].includes(order.status))
        actions += '<button class="btn btn-danger" data-act="cancel">取消订单</button>';
    }
    if (role === Models.ROLES.RUNNER && order.runnerId === u.id) {
      if (order.status === Models.ORDER_STATUSES.ACCEPTED) actions += '<button class="btn btn-primary" data-act="picking">开始取货</button>';
      if (order.status === Models.ORDER_STATUSES.PICKING) actions += '<button class="btn btn-primary" data-act="delivering">开始配送</button>';
      if (order.status === Models.ORDER_STATUSES.DELIVERING) actions += '<button class="btn btn-success" data-act="complete">确认送达</button>';
      if ([Models.ORDER_STATUSES.ACCEPTED, Models.ORDER_STATUSES.PICKING, Models.ORDER_STATUSES.DELIVERING].includes(order.status))
        actions += '<button class="btn btn-warning" data-act="exception">上报异常</button>';
    }
    if (role === Models.ROLES.ADMIN && order.status === Models.ORDER_STATUSES.EXCEPTION) {
      actions += '<button class="btn btn-warning" data-act="edit_exception">编辑异常</button>';
      actions += '<button class="btn btn-primary" data-act="resolve_reaccept">转重新接单</button>';
    }
    if (role === Models.ROLES.FINANCE) {
      if (order.status === Models.ORDER_STATUSES.EXCEPTION && !order.financeReviewed)
        actions += '<button class="btn btn-primary" data-act="finance_review">财务复核</button>';
      if ((order.status === Models.ORDER_STATUSES.CANCELLED || order.status === Models.ORDER_STATUSES.EXCEPTION) && order.penaltyAmount > 0 && order.financeRefundApproved !== true) {
        actions += '<button class="btn btn-success" data-act="refund_approve">同意退款</button>';
        actions += '<button class="btn btn-danger" data-act="refund_reject">拒绝退款</button>';
      }
    }
    actions += '<button class="btn btn-outline" data-act="audit_logs">审计日志</button>';
    let h = '<div class="page-header"><div><h2 class="page-title">📋 订单详情</h2>' +
      '<div class="text-sm text-muted">订单号：' + order.code + ' · ' + UI.formatTime(order.createdAt) + '</div></div>' +
      '<div class="page-actions">' + actions + '</div></div>';
    h += '<div class="grid-2">';
    h += '<div class="card"><div class="card-header"><div class="card-title">📊 进度</div></div><div class="card-body">' + UI.orderTimeline(order) + '</div></div>';
    h += '<div class="card"><div class="card-header"><div class="card-title">💰 费用</div><button class="btn btn-ghost btn-sm" data-act="recalc_fee">重算</button></div><div class="card-body">';
    if (order.feeDetail) h += UI.feeBreakdown(order.feeDetail);
    if (order.cancelReason) h += '<div class="mt-md" style="padding:12px;background:#fef2f2;border-radius:8px">' +
      '<div class="font-bold text-danger">取消信息</div><div class="text-sm mt-sm">原因：' + UI.escapeHtml(order.cancelReason) + '</div>' +
      (order.penaltyAmount ? '<div class="text-sm text-danger mt-sm">违约金：' + UI.formatMoney(order.penaltyAmount) + '</div>' : '') +
      '<div class="text-sm text-muted mt-sm">取消人：' + UI.escapeHtml(order.cancelledBy || '') + ' · ' + UI.formatTime(order.cancelledAt) + '</div></div>';
    if (order.exceptionNote) {
      h += '<div class="mt-md" style="padding:12px;background:#fff7ed;border-radius:8px">' +
        '<div class="font-bold text-warning">异常信息</div><div class="text-sm mt-sm">当前：' + UI.escapeHtml(order.exceptionNote) + '</div>';
      if (order.exceptionHistory && order.exceptionHistory.length > 0) {
        h += '<div class="mt-sm"><div class="text-sm text-muted mb-sm">历史版本：</div><div class="version-history">';
        order.exceptionHistory.slice().reverse().forEach((v, i) => {
          h += '<div class="version-item"><div class="version-content">' + UI.escapeHtml(v.note || '') + '</div>' +
            '<div class="version-meta"><div class="version-num">v' + (order.exceptionHistory.length - i) + '</div>' +
            '<div class="text-sm text-light">' + UI.formatTime(v.timestamp) + '</div><div class="text-sm text-muted">' + UI.escapeHtml(v.actor || '') + '</div></div></div>';
        });
        h += '</div></div>';
      }
      if (order.financeReviewNote) h += '<div class="mt-sm" style="padding:8px 12px;background:#f0f9ff;border-radius:6px">' +
        '<div class="text-sm font-bold text-info">财务复核</div><div class="text-sm mt-sm">' + UI.escapeHtml(order.financeReviewNote) + '</div>' +
        (order.financeRefundApproved !== undefined ? '<div class="text-sm mt-sm ' + (order.financeRefundApproved ? 'text-success' : 'text-danger') + '">' + (order.financeRefundApproved ? '✅ 已同意退款' : '❌ 已拒绝退款') + '</div>' : '') + '</div>';
      h += '</div>';
    }
    h += '</div></div>';
    h += '<div class="card"><div class="card-header"><div class="card-title">📝 基本信息</div></div><div class="card-body">';
    const rows = [['标题', order.title], ['备注', order.description || '-'], ['取货', order.pickupAddress], ['送达', order.deliveryAddress],
      ['取件联系', order.pickupContact], ['收件联系', order.deliveryContact], ['学生', order.studentName],
      ['跑腿员', order.runnerName || '-'], ['重量', order.weightKg + 'kg'], ['距离', order.distanceKm + 'km'],
      ['夜间', order.isNight ? '是' : '否'], ['超重确认', order.overWeightConfirmed ? '✅' : '否']];
    rows.forEach(r => { h += '<div class="flex-between" style="padding:8px 0;border-bottom:1px dashed var(--border)"><span class="text-muted">' + r[0] + '</span><span class="font-mono">' + r[1] + '</span></div>'; });
    h += '</div></div>';
    h += '<div class="card"><div class="card-header"><div class="card-title">🗂️ 状态流转</div></div><div class="card-body">';
    if (!order.statusHistory || order.statusHistory.length === 0) h += '<div class="text-muted">暂无</div>';
    else order.statusHistory.slice().reverse().forEach(hh => {
      h += '<div class="timeline-item done" style="padding-bottom:16px"><div class="timeline-time">' + UI.formatTime(hh.timestamp) + ' · ' + UI.escapeHtml(hh.actorName || hh.actor) + ' (' + Models.ROLE_LABELS[hh.actorRole || 'student'] + ')</div>' +
        '<div class="timeline-title">' + UI.statusBadge(hh.from) + ' → ' + UI.statusBadge(hh.to) + '</div>' + (hh.note ? '<div class="timeline-desc">' + UI.escapeHtml(hh.note) + '</div>' : '') + '</div>';
    });
    h += '</div></div></div>';
    return h;
  }

  function bindOrderDetail(params) {
    const id = (params || {}).id; const u = Storage.getCurrentUser(); const role = Storage.getCurrentRole();
    const actor = Object.assign({}, u, { role }); const refresh = () => App.renderPage('order_detail', { id });
    const updateTransition = async (next, note) => {
      const r = await Concurrency.atomicUpdateOrder(id, async (order) => {
        const tr = await StateMachine.transition(order, next, actor, note);
        Object.assign(order, tr.order);
      }, 'TR_' + next + '_' + id);
      if (r.success) UI.showToast('成功', note || '状态已更新', 'success'); else UI.showToast('失败', r.message, 'error');
      setTimeout(refresh, 500); return r;
    };
    const handler = {
      cancel: () => Modals.showCancelOrder(id),
      picking: () => updateTransition(Models.ORDER_STATUSES.PICKING, '到达取货点'),
      delivering: () => updateTransition(Models.ORDER_STATUSES.DELIVERING, '取货完成，开始配送'),
      complete: async () => {
        const r = await Concurrency.atomicUpdateOrder(id, async (order) => {
          const tr = await StateMachine.transition(order, Models.ORDER_STATUSES.DELIVERED, actor, '已送达');
          Object.assign(order, tr.order);
          order.deliveryNodes = order.deliveryNodes || []; order.deliveryNodes.push({ type: 'delivered', ts: Date.now() });
        }, 'COMPLETE_' + id);
        if (r.success) {
          UI.showToast('🎉 完成', '订单完成', 'success');
          const runners = await DB.getAll(DB.STORES.runners);
          const me = runners.find(rr => rr.id === u.id);
          if (me) { me.ordersCompleted = (me.ordersCompleted || 0) + 1; await DB.put(DB.STORES.runners, me); }
        } else UI.showToast('失败', r.message, 'error');
        setTimeout(refresh, 500);
      },
      exception: () => Modals.showExceptionReport(id),
      edit_exception: () => Modals.showExceptionReport(id, { mode: 'edit' }),
      resolve_reaccept: async () => {
        const r = await Concurrency.atomicUpdateOrder(id, async (order) => {
          const tr = await StateMachine.transition(order, Models.ORDER_STATUSES.PENDING_ACCEPT, actor, '异常已解决，转重新接单');
          Object.assign(order, tr.order); order.runnerId = null; order.runnerName = null;
        }, 'RESOLVE_' + id);
        if (r.success) UI.showToast('成功', '已转重新接单', 'success'); else UI.showToast('失败', r.message, 'error');
        setTimeout(refresh, 500);
      },
      finance_review: () => Modals.showFinanceReview(id),
      refund_approve: async () => {
        const r = await Concurrency.atomicUpdateOrder(id, (order) => {
          order.financeReviewed = true; order.financeRefundApproved = true;
          order.financeReviewNote = '财务复核通过，同意退款 ¥' + (order.penaltyAmount || 0).toFixed(2);
        }, 'REFUND_AP_' + id);
        if (r.success) { const o = await DB.get(DB.STORES.orders, id); await Audit.log(Audit.ACTIONS.FINANCE_REFUND_APPROVE, id, { amount: (o || {}).penaltyAmount || 0 }, 'AUDIT'); UI.showToast('退款已同意', '', 'success'); }
        else UI.showToast('失败', r.message, 'error');
        setTimeout(refresh, 500);
      },
      refund_reject: async () => {
        const r = await Concurrency.atomicUpdateOrder(id, (order) => {
          order.financeReviewed = true; order.financeRefundApproved = false;
          order.financeReviewNote = '财务复核不通过，不符合退款条件';
        }, 'REFUND_RJ_' + id);
        if (r.success) { await Audit.log(Audit.ACTIONS.FINANCE_REFUND_REJECT, id, {}, 'AUDIT'); UI.showToast('已拒绝', '', 'warning'); }
        else UI.showToast('失败', r.message, 'error');
        setTimeout(refresh, 500);
      },
      recalc_fee: async () => {
        const o = await DB.get(DB.STORES.orders, id); if (!o) return;
        const nd = FeeEngine.recalculateOrder(o, { overWeightConfirmed: o.overWeightConfirmed });
        await Concurrency.atomicUpdateOrder(id, (order) => {
          order.feeDetail = nd; order.totalAmount = nd.finalTotal;
          order.payAmount = nd.overweight && nd.overweight.required ? nd.overweightTotal : nd.finalTotal;
        }, 'RECALC_' + id);
        await FeeEngine.validateAndSaveCalculation(id, nd);
        UI.showToast('已重算', '新金额：' + UI.formatMoney(nd.finalTotal), 'info');
        setTimeout(refresh, 300);
      },
      audit_logs: () => Modals.showAuditLogs(id)
    };
    document.querySelectorAll('[data-act]').forEach(b => { const a = b.getAttribute('data-act'); if (handler[a]) b.addEventListener('click', handler[a]); });
  }

  async function pageRunnerBusy() {
    const u = Storage.getCurrentUser(); const state = Storage.getRunnerBusyState(u.id) || {};
    const runners = await DB.getAll(DB.STORES.runners);
    const me = runners.find(r => r.id === u.id) || { name: u.name, rating: 5, ordersCompleted: 0 };
    const s = await stats();
    let h = '<div class="page-header"><h2 class="page-title">⏸️ 忙碌状态</h2></div><div class="grid-3">';
    h += '<div class="card"><div class="card-header"><div class="card-title">👤 我的信息</div></div><div class="card-body">' +
      '<div class="text-lg font-bold">' + me.name + '</div><div class="text-sm text-muted mt-sm">评分：' + (me.rating || 5) + ' ⭐</div>' +
      '<div class="text-sm text-muted">完成：' + (me.ordersCompleted || 0) + ' 单</div></div></div>';
    h += '<div class="card"><div class="card-header"><div class="card-title">🔘 当前状态</div></div><div class="card-body">' +
      '<div class="busy-indicator ' + (state.isBusy ? '' : 'off') + '" style="font-size:16px;padding:10px 20px">' + (state.isBusy ? '忙碌中' : '空闲') + '</div>' +
      (state.isBusy && state.reason ? '<div class="mt-md text-sm">原因：' + UI.escapeHtml(state.reason) + '</div>' : '') +
      (state._updatedAt ? '<div class="mt-sm text-sm text-muted">更新：' + UI.formatTime(state._updatedAt) + '</div>' : '') + '</div></div>';
    h += '<div class="card"><div class="card-header"><div class="card-title">⚙️ 控制</div></div><div class="card-body">' +
      '<div class="form-group"><label class="form-label">忙碌原因</label><input class="form-input" id="busyReason" placeholder="吃饭/休息/处理其他..." value="' + UI.escapeHtml(state.reason || '') + '"></div>' +
      '<div class="flex gap-md mt-md"><button class="btn btn-success flex-1" id="setFreeBtn">设为空闲</button>' +
      '<button class="btn btn-warning flex-1" id="setBusyBtn">设为忙碌</button></div></div></div></div>';
    h += '<div class="order-stats">' + statsCards(s, Models.ROLES.RUNNER) + '</div>';
    return h;
  }

  function bindRunnerBusy() {
    const u = Storage.getCurrentUser(); const refresh = () => App.renderPage('runner_busy');
    const save = (isBusy) => {
      const reason = (document.getElementById('busyReason') || {}).value || (isBusy ? '手动设置' : null);
      Storage.setRunnerBusyState(u.id, { isBusy, reason });
      DB.open().then(async () => {
        const runners = await DB.getAll(DB.STORES.runners);
        const me = runners.find(r => r.id === u.id);
        if (me) { me.isBusy = isBusy; me.busyReason = reason; me.busySince = isBusy ? Date.now() : null; await DB.put(DB.STORES.runners, me); }
      });
      Audit.log(isBusy ? Audit.ACTIONS.RUNNER_BUSY_SET : Audit.ACTIONS.RUNNER_BUSY_CLEAR, u.id, { isBusy, reason }, 'AUDIT');
    };
    document.getElementById('setFreeBtn')?.addEventListener('click', () => { save(false); UI.showToast('已空闲', '', 'success'); setTimeout(refresh, 300); });
    document.getElementById('setBusyBtn')?.addEventListener('click', () => { save(true); UI.showToast('已忙碌', '', 'warning'); setTimeout(refresh, 300); });
  }

  async function pageAllOrders() { const s = await stats(); const f = Storage.getLastFilters('all_orders'); return '<div class="page-header"><h2 class="page-title">📊 全部订单</h2></div><div class="order-stats">' + statsCards(s, Models.ROLES.ADMIN) + '</div>' + orderTable(await listOrders(f), 'all_orders'); }
  async function pageExceptionMgmt() { const orders = (await listOrders(Storage.getLastFilters('exception_mgmt', {}))).filter(o => o.status === Models.ORDER_STATUSES.EXCEPTION); return '<div class="page-header"><h2 class="page-title">⚠️ 异常管理</h2><div class="text-muted text-sm">共 ' + orders.length + ' 单</div></div>' + orderTable(orders, 'exception_mgmt'); }
  async function pageFinanceReview() { const all = await listOrders(Storage.getLastFilters('finance_review', {}));
    const need = all.filter(o => (o.status === Models.ORDER_STATUSES.EXCEPTION && !o.financeReviewed) || ((o.status === Models.ORDER_STATUSES.CANCELLED || o.status === Models.ORDER_STATUSES.EXCEPTION) && o.penaltyAmount > 0 && !o.financeRefundApproved));
    const s = await stats();
    return '<div class="page-header"><h2 class="page-title">✅ 财务复核</h2><div class="text-muted text-sm">待复核：' + need.length + ' 单</div></div>' +
      '<div class="order-stats">' + statsCards(s, Models.ROLES.FINANCE) + '</div>' + orderTable(need, 'finance_review'); }
  async function pageMyDeliveries() { const u = Storage.getCurrentUser(); const s = await stats(); return '<div class="page-header"><h2 class="page-title">🚴 我的配送</h2></div><div class="order-stats">' + statsCards(s, Models.ROLES.RUNNER) + '</div>' + orderTable(await listOrders(Object.assign(Storage.getLastFilters('my_deliveries', {}), { runnerId: u.id })), 'my_deliveries'); }
  async function pageRunnerMgmt() { const runners = await DB.getAll(DB.STORES.runners);
    return '<div class="page-header"><h2 class="page-title">👥 跑腿员管理</h2></div><div class="card"><div class="card-body"><table class="data-table"><thead><tr>' +
      '<th>姓名</th><th>ID</th><th>状态</th><th>评分</th><th>完成</th><th>忙碌时间</th></tr></thead><tbody>' +
      runners.map(r => '<tr><td class="font-bold">' + r.name + '</td><td class="font-mono text-sm">' + r.id + '</td>' +
        '<td><span class="busy-indicator ' + (r.isBusy ? '' : 'off') + '" style="font-size:11px;padding:2px 8px">' + (r.isBusy ? '忙碌' : '空闲') + '</span></td>' +
        '<td>⭐ ' + (r.rating || 5) + '</td><td>' + (r.ordersCompleted || 0) + '</td><td class="text-sm text-muted">' + (r.busySince ? UI.formatTime(r.busySince) : '-') + '</td></tr>').join('') +
      '</tbody></table></div></div>';
  }
  async function pageCouponMgmt() { const coupons = await DB.getAll(DB.STORES.coupons);
    return '<div class="page-header"><h2 class="page-title">🎟️ 优惠券管理</h2></div><div class="card"><div class="card-body"><table class="data-table"><thead><tr>' +
      '<th>券码</th><th>名称</th><th>类型</th><th>面额</th><th>门槛</th><th>互斥组</th><th>状态</th><th>有效期</th></tr></thead><tbody>' +
      coupons.map(c => '<tr><td class="font-mono font-bold">' + c.code + '</td><td>' + c.name + '</td>' +
        '<td>' + ({ amount: '金额券', percent: '折扣券', freeship: '免基础费' }[c.type] || c.type) + '</td>' +
        '<td>' + (c.type === 'percent' ? (100 - c.value) / 10 + '折' : c.type === 'freeship' ? '免基础费' : '¥' + c.value) + '</td>' +
        '<td>满¥' + (c.minAmount || 0) + '</td><td>' + (c.mutexGroup || 'FULL') + '</td>' +
        '<td>' + (c.used ? '<span class="text-muted">已使用</span>' : '<span class="text-success">可用</span>') + '</td>' +
        '<td class="text-sm">' + UI.formatTime(c.validFrom).slice(0, 10) + ' ~ ' + UI.formatTime(c.validUntil).slice(0, 10) + '</td></tr>').join('') +
      '</tbody></table></div></div>';
  }
  async function pageCouponMine() { const cList = (await DB.getAll(DB.STORES.coupons)).filter(c => !c.used && c.validFrom <= Date.now() && c.validUntil >= Date.now());
    let h = '<div class="page-header"><h2 class="page-title">🎟️ 我的优惠券</h2><div class="text-muted text-sm">可用：' + cList.length + ' 张</div></div><div class="grid-3">';
    if (cList.length === 0) h = '<div class="empty-state"><div class="icon">🎟️</div><div class="text">暂无可用优惠券</div></div>';
    else cList.forEach(c => {
      h += '<div class="card"><div class="card-body"><div class="flex-between"><div class="text-xl font-bold text-primary">' +
        (c.type === 'amount' ? '¥' + c.value : c.type === 'percent' ? (100 - c.value) / 10 + '折' : '免基础费') +
        '</div><span class="tag tag-coupon">' + (c.mutexGroup || 'FULL') + '</span></div>' +
        '<div class="mt-sm font-bold">' + c.name + '</div><div class="text-sm text-muted mt-sm">券码：' + c.code + '</div>' +
        '<div class="text-sm text-muted">满¥' + (c.minAmount || 0) + '可用</div></div></div>';
    });
    if (cList.length > 0) h += '</div>';
    return h;
  }
  async function pageFinanceStats() { const orders = await listOrders({}); const s = await stats();
    const total = orders.filter(o => o.status === Models.ORDER_STATUSES.DELIVERED).reduce((a, b) => a + (b.payAmount || 0), 0);
    const penalty = orders.reduce((a, b) => a + (b.penaltyAmount || 0), 0);
    return '<div class="page-header"><h2 class="page-title">📈 财务统计</h2></div><div class="grid-4">' +
      '<div class="stat-card total"><div class="stat-label">💵 累计收入</div><div class="stat-value font-mono">¥' + total.toFixed(2) + '</div></div>' +
      '<div class="stat-card success"><div class="stat-label">✅ 完成订单</div><div class="stat-value">' + s.delivered + '</div></div>' +
      '<div class="stat-card fail"><div class="stat-label">⚠️ 异常单</div><div class="stat-value">' + s.exception + '</div></div>' +
      '<div class="stat-card busy"><div class="stat-label">💸 违约金</div><div class="stat-value font-mono">¥' + penalty.toFixed(2) + '</div></div></div>';
  }

  const PAGE_MAP = {
    order_create: { render: pageOrderCreate, bind: bindOrderCreate },
    order_list_student: { render: pageStudentList, bind: bindStudentList },
    order_pool: { render: pageOrderPool, bind: bindOrderPool },
    order_detail: { render: pageOrderDetail, bind: bindOrderDetail },
    runner_busy: { render: pageRunnerBusy, bind: bindRunnerBusy },
    all_orders: { render: pageAllOrders, bind: () => bindOrderTable('all_orders') },
    exception_mgmt: { render: pageExceptionMgmt, bind: () => bindOrderTable('exception_mgmt') },
    finance_review: { render: pageFinanceReview, bind: () => bindOrderTable('finance_review') },
    my_deliveries: { render: pageMyDeliveries, bind: () => bindOrderTable('my_deliveries') },
    runner_mgmt: { render: pageRunnerMgmt, bind: () => {} },
    coupon_mgmt: { render: pageCouponMgmt, bind: () => {} },
    coupon_mine: { render: pageCouponMine, bind: () => {} },
    finance_refund: { render: pageFinanceReview, bind: () => bindOrderTable('finance_review') },
    finance_stats: { render: pageFinanceStats, bind: () => {} },
    order_detail_mine: { render: pageOrderDetail, bind: bindOrderDetail }
  };

  function defaultPageForRole(role) {
    return ({
      [Models.ROLES.STUDENT]: 'order_list_student',
      [Models.ROLES.RUNNER]: 'order_pool',
      [Models.ROLES.ADMIN]: 'all_orders',
      [Models.ROLES.FINANCE]: 'finance_review'
    })[role] || 'order_list_student';
  }

  return { seedTestData, stats, PAGE_MAP, defaultPageForRole, listOrders };
})();
