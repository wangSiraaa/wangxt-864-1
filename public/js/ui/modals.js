'use strict';

(function(global) {
  const Modals = {};

  const _UI = global.UI || {};
  const _t = (t, d, ty) => (_UI.showToast || global.showToast || function(){})(t, d, ty);
  const _m = (h, o) => (_UI.openModal || global.openModal || function(){ return { close: function(){} }; })(h, o);
  const _fb = (d, o) => (_UI.feeBreakdown || global.feeBreakdown || function(){ return ''; })(d, o);
  const _nav = (p, params) => { if (global.App && global.App.renderPage) global.App.renderPage(p, params); else if (typeof global.navigateTo === 'function') global.navigateTo(p, params); };
  const _e = (s) => {
    if (_UI.escapeHtml) return _UI.escapeHtml(s);
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  };
  const _dl = (obj, filename) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 100);
  };
  const _closeFn = (modalRet) => modalRet && modalRet.close
    ? () => modalRet.close()
    : () => { const r = document.getElementById('modalRoot'); if (r) r.innerHTML = ''; };

  // ========== 1. 取消订单弹窗 ==========
  Modals.showCancelOrder = async function(orderId) {
    await DB.open();
    const order = await DB.get('orders', orderId);
    if (!order) { _t('错误', '订单不存在', 'error'); return; }
    const penalty = FeeEngine.calculateCancellationPenalty(order);
    const canCancel = ['pending_pay', 'pending_accept', 'accepted'].indexOf(order.status) >= 0;

    const html = [
      '<div class="modal-body">',
      '  <div class="section-title">取消订单</div>',
      '  <div class="info-grid" style="margin-bottom:16px">',
      '    <div class="info-row"><span class="info-label">订单编号</span><span class="info-value">' + _e(order.code) + '</span></div>',
      '    <div class="info-row"><span class="info-label">当前状态</span><span class="status-badge status-' + order.status + '">' + _e(order.statusName || Models.STATUS_LABELS[order.status]) + '</span></div>',
      '    <div class="info-row"><span class="info-label">订单金额</span><span class="info-value">¥' + (Number(order.finalTotal) || 0).toFixed(2) + '</span></div>',
      '  </div>',
      '  <div style="' + (penalty.penaltyAmount > 0 ? 'background:#FFF7E6;border:1px solid #FFD591;' : 'background:#F6FFED;border:1px solid #B7EB8F;') + 'padding:12px;border-radius:8px;margin-bottom:16px">',
      '    <div style="font-weight:600;margin-bottom:4px">' + (penalty.canCancel ? (penalty.penaltyAmount > 0 ? '⚠️ 将产生违约金' : '✅ 无违约金') : '❌ 不可取消') + '</div>',
      '    <div style="font-size:12px;opacity:.85">' + _e(penalty.reason || '') + '</div>',
      penalty.penaltyAmount > 0 ? '<div style="margin-top:8px;font-size:14px">违约金：<b style="color:#CF1322">¥' + penalty.penaltyAmount.toFixed(2) + '</b>（' + (penalty.percent * 100) + '%）</div>' : '',
      '  </div>',
      canCancel ? [
        '  <div class="form-group">',
        '    <label class="form-label required">取消原因 <span style="color:#CF1322">*</span></label>',
        '    <select id="cancel-reason" class="form-control" style="margin-bottom:8px">',
        '      <option value="">-- 请选择原因 --</option>',
        '      <option>不需要了</option><option>价格太高</option><option>等待时间太长</option>',
        '      <option>跑腿员太慢</option><option>信息填错了</option><option>其他原因</option>',
        '    </select>',
        '    <textarea id="cancel-detail" class="form-control" rows="3" placeholder="补充说明（选填，5-200字）" style="resize:vertical"></textarea>',
        '  </div>',
        '  <div id="cancel-err" style="color:#CF1322;font-size:12px;margin-top:4px;display:none">请选择取消原因</div>',
      ].join('') : '<div style="color:#8C8C8C;text-align:center;padding:20px">当前状态不允许取消，请联系管理员</div>',
      '</div>',
    ].join('');

    const footer = canCancel
      ? '<button class="btn btn-ghost" id="cancel-close">关闭</button><button class="btn btn-primary" id="cancel-confirm">确认取消' + (penalty.penaltyAmount > 0 ? '（扣违约金）' : '') + '</button>'
      : '<button class="btn btn-primary" id="cancel-close">关闭</button>';

    const close = _closeFn(_m(html, { title: '取消订单 - ' + order.code, size: 'md', footerHtml: footer }));

    const closeBtn = document.getElementById('cancel-close');
    if (closeBtn) closeBtn.onclick = close;

    const confirmBtn = document.getElementById('cancel-confirm');
    if (confirmBtn && canCancel) {
      confirmBtn.onclick = async function() {
        const reason = (document.getElementById('cancel-reason').value || '').trim();
        const detail = (document.getElementById('cancel-detail').value || '').trim();
        const errDiv = document.getElementById('cancel-err');
        const reasonSel = document.getElementById('cancel-reason');
        if (!reason) { errDiv.style.display = 'block'; reasonSel.style.borderColor = '#CF1322'; return; }
        errDiv.style.display = 'none'; reasonSel.style.borderColor = '';
        try {
          await DB.open();
          const orderCur = await DB.get('orders', orderId);
          if (!orderCur) throw new Error('订单已删除');
          const penaltyCur = FeeEngine.calculateCancellationPenalty(orderCur);
          if (!penaltyCur.canCancel) throw new Error(penaltyCur.reason);
          const actor = Storage.getCurrentUser() || {};
          const record = {
            id: 'CR_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            orderId: orderId, reason: reason, detail: detail,
            penaltyAmount: penaltyCur.penaltyAmount, penaltyPercent: penaltyCur.percent,
            actor: actor.id, actorName: actor.name, createdAt: new Date().toISOString(),
          };
          await DB.put('cancelRecords', record);
          orderCur.cancelRecord = record;
          orderCur.penaltyAmount = penaltyCur.penaltyAmount;
          const tr = StateMachine.transition(orderCur, 'cancelled', actor, '取消原因：' + reason + '；' + (detail || ''));
          if (!tr.success) throw new Error(tr.reason);
          if (orderCur.status === 'cancelled' && orderCur.runnerId) {
            const runner = await DB.get('runners', orderCur.runnerId);
            if (runner) {
              runner.status = 'idle'; runner.currentOrderId = null;
              await DB.put('runners', runner);
              Storage.setRunnerBusyState(runner.id, false, null);
              Audit.log(Audit.ACTIONS.RUNNER_STATUS_CHANGED, runner.id, { from: 'busy', to: 'idle', reason: 'order_cancelled' });
            }
          }
          await DB.put('orders', orderCur);
          Audit.log(Audit.ACTIONS.ORDER_CANCELLED, orderId, { reason: reason, detail: detail, penalty: penaltyCur.penaltyAmount });
          close();
          _t('取消成功', penaltyCur.penaltyAmount > 0 ? '已扣除违约金 ¥' + penaltyCur.penaltyAmount.toFixed(2) : '订单已取消', 'success');
          setTimeout(() => _nav('my-orders'), 400);
        } catch (e) { _t('取消失败', e.message || String(e), 'error'); }
      };
    }
  };

  // ========== 2. 异常备注弹窗 ==========
  Modals.showExceptionReport = async function(orderId, opts) {
    opts = opts || {};
    const mode = opts.mode || 'create';
    await DB.open();
    const order = await DB.get('orders', orderId);
    if (!order) { _t('错误', '订单不存在', 'error'); return; }
    const existing = (await DB.getByIndex('exceptionNotes', 'orderId', orderId)) || [];
    const lastNote = existing.length > 0 ? existing.slice().sort((a,b)=>b.version-a.version)[0] : null;

    const historyHtml = existing.length === 0 ? '' : [
      '<div style="margin-bottom:16px">',
      '  <div class="section-title" style="margin-bottom:8px">历史版本 (' + existing.length + ')</div>',
      '  <div style="max-height:180px;overflow-y:auto;border:1px solid #F0F0F0;border-radius:6px">',
      existing.slice().sort((a,b)=>b.version-a.version).map(n => [
        '<div style="padding:10px 12px;border-bottom:1px solid #F5F5F5;' + (n.id === (lastNote && lastNote.id) ? 'background:#E6F7FF;' : '') + '">',
        '  <div style="display:flex;justify-content:space-between;margin-bottom:4px">',
        '    <span style="font-weight:600;font-size:13px">v' + n.version + ' ' + _e(n.category) + '</span>',
        '    <span style="font-size:11px;color:#8C8C8C">' + (new Date(n.createdAt)).toLocaleString() + '</span>',
        '  </div>',
        '  <div style="font-size:12px;color:#595959;margin-bottom:4px">' + _e(n.content) + '</div>',
        '  <div style="font-size:11px;color:#8C8C8C">操作人：' + _e(n.actorName || n.actor) + (n.handledBy ? ' | 处理人：' + _e(n.handledBy) : '') + '</div>',
        '</div>',
      ].join('')).join(''),
      '  </div>',
      '</div>',
    ].join('');

    const isReadOnly = mode === 'view';
    const html = [
      '<div class="modal-body">',
      '  <div class="info-grid" style="margin-bottom:16px">',
      '    <div class="info-row"><span class="info-label">订单</span><span class="info-value">' + _e(order.code) + '</span></div>',
      '    <div class="info-row"><span class="info-label">状态</span><span class="status-badge status-' + order.status + '">' + _e(order.statusName || Models.STATUS_LABELS[order.status]) + '</span></div>',
      '  </div>',
      historyHtml,
      isReadOnly ? '' : [
        '  <div class="section-title">新增异常备注</div>',
        '  <div class="form-group">',
        '    <label class="form-label required">异常分类 <span style="color:#CF1322">*</span></label>',
        '    <select id="ex-category" class="form-control">',
        '      <option value="">-- 选择分类 --</option>',
        '      <option>商品破损</option><option>地址错误</option><option>联系不上客户</option>',
        '      <option>重量不符</option><option>跑腿员受伤</option><option>天气原因</option><option>其他</option>',
        '    </select>',
        '  </div>',
        '  <div class="form-group">',
        '    <label class="form-label required">异常描述 <span style="color:#CF1322">*</span></label>',
        '    <textarea id="ex-content" class="form-control" rows="4" placeholder="请详细描述异常情况（10-500字）" style="resize:vertical"></textarea>',
        '  </div>',
        '  <div class="form-group">',
        '    <label class="form-label">严重程度</label>',
        '    <select id="ex-severity" class="form-control">',
        '      <option value="low">低（延误但可解决）</option>',
        '      <option value="medium" selected>中（需要协调）</option>',
        '      <option value="high">高（订单可能失败）</option>',
        '    </select>',
        '  </div>',
        '  <div class="form-group">',
        '    <label class="form-label">建议处理方式</label>',
        '    <textarea id="ex-suggestion" class="form-control" rows="2" placeholder="选填" style="resize:vertical"></textarea>',
        '  </div>',
        '  <div id="ex-err" style="color:#CF1322;font-size:12px;display:none"></div>',
      ].join(''),
      '</div>',
    ].join('');

    const footer = isReadOnly
      ? '<button class="btn btn-primary" id="ex-close">关闭</button>'
      : '<button class="btn btn-ghost" id="ex-close">取消</button>' +
        '<button class="btn btn-warn" id="ex-save">保存为 v' + ((lastNote ? lastNote.version : 0) + 1) + '</button>' +
        '<button class="btn btn-primary" id="ex-send">保存并流转异常复核</button>';

    const close = _closeFn(_m(html, { title: '异常备注 - ' + order.code, size: 'lg', footerHtml: footer }));
    document.getElementById('ex-close').onclick = close;
    if (isReadOnly) return;

    const saveFn = async function(goToReview) {
      const cat = (document.getElementById('ex-category').value || '').trim();
      const content = (document.getElementById('ex-content').value || '').trim();
      const severity = document.getElementById('ex-severity').value;
      const sugg = (document.getElementById('ex-suggestion').value || '').trim();
      const err = document.getElementById('ex-err');
      if (!cat || !content) { err.textContent = !cat ? '请选择异常分类' : '请填写异常描述'; err.style.display = 'block'; return; }
      if (content.length < 5) { err.textContent = '异常描述至少5个字'; err.style.display = 'block'; return; }
      err.style.display = 'none';
      try {
        await DB.open();
        const orderCur = await DB.get('orders', orderId);
        const allNotes = (await DB.getByIndex('exceptionNotes', 'orderId', orderId)) || [];
        const newVersion = allNotes.length === 0 ? 1 : (allNotes.reduce((m,n)=>Math.max(m,n.version),0) + 1);
        const actor = Storage.getCurrentUser() || {};
        const note = {
          id: 'EX_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
          orderId: orderId, version: newVersion, category: cat, content: content, severity: severity,
          suggestion: sugg, actor: actor.id, actorName: actor.name,
          createdAt: new Date().toISOString(), handled: false,
        };
        await DB.put('exceptionNotes', note);
        if (!orderCur.exceptionNotes) orderCur.exceptionNotes = [];
        orderCur.exceptionNotes.push(note.id);
        orderCur.lastExceptionNote = { version: newVersion, category: cat, severity: severity, createdAt: note.createdAt };
        Audit.log(Audit.ACTIONS.EXCEPTION_NOTE_ADDED, orderId, { version: newVersion, category: cat, severity: severity });
        if (goToReview) {
          const tr = StateMachine.transition(orderCur, 'exception_review', actor, '异常升级：' + cat + ' - ' + content.slice(0,30));
          if (!tr.success) Audit.log(Audit.ACTIONS.STATUS_TRANSITION_FAILED, orderId, { reason: tr.reason });
          orderCur.reviewRequired = true;
          Audit.log(Audit.ACTIONS.ORDER_EXCEPTION_REVIEW, orderId, { noteVersion: newVersion });
        }
        await DB.put('orders', orderCur);
        close();
        _t('已保存', '异常备注 v' + newVersion + ' 已记录' + (goToReview ? '，并流转到异常复核' : ''), 'success');
        setTimeout(() => _nav('order-detail', orderId), 400);
      } catch (e) { _t('保存失败', e.message || String(e), 'error'); }
    };
    document.getElementById('ex-save').onclick = () => saveFn(false);
    document.getElementById('ex-send').onclick = () => saveFn(true);
  };

  // ========== 3. 财务复核弹窗 ==========
  Modals.showFinanceReview = async function(orderId) {
    await DB.open();
    const order = await DB.get('orders', orderId);
    if (!order) { _t('错误', '订单不存在', 'error'); return; }
    const user = Storage.getCurrentUser() || {};
    if (user.role !== 'finance') { _t('权限不足', '仅财务复核员可操作', 'error'); return; }

    const penalty = Number(order.penaltyAmount) || 0;
    const paidAmount = Number(order.paidAmount) || 0;
    const finalTotal = Number(order.finalTotal) || 0;
    const refundAmount = paidAmount ? (order.status === 'cancelled' ? Math.max(0, paidAmount - penalty) : finalTotal) : 0;
    const needRefund = order.status === 'cancelled' && refundAmount > 0;
    const needVerify = order.status === 'delivered' && !order.financeVerified;
    const needReview = order.status === 'exception_review';

    const html = [
      '<div class="modal-body">',
      '  <div class="section-title">订单基础</div>',
      '  <div class="info-grid" style="margin-bottom:16px">',
      '    <div class="info-row"><span class="info-label">订单</span><span class="info-value">' + _e(order.code) + '</span></div>',
      '    <div class="info-row"><span class="info-label">状态</span><span class="status-badge status-' + order.status + '">' + _e(order.statusName || Models.STATUS_LABELS[order.status]) + '</span></div>',
      '    <div class="info-row"><span class="info-label">下单时间</span><span class="info-value">' + (new Date(order.createdAt)).toLocaleString() + '</span></div>',
      '    <div class="info-row"><span class="info-label">实付金额</span><span class="info-value">¥' + paidAmount.toFixed(2) + '</span></div>',
      '    <div class="info-row"><span class="info-label">违约金</span><span class="info-value" style="color:#CF1322">¥' + penalty.toFixed(2) + '</span></div>',
      '    <div class="info-row"><span class="info-label">应退金额</span><span class="info-value" style="color:#389E0D;font-weight:600">¥' + refundAmount.toFixed(2) + '</span></div>',
      '  </div>',
      '  <div class="section-title">费用明细（可重算）</div>',
      '  <div id="finance-fee-box" style="margin-bottom:16px;border:1px solid #F0F0F0;border-radius:8px;padding:12px">' + _fb(order.feeDetail || {}) + '</div>',
      '  <div style="margin-bottom:16px;text-align:right"><button class="btn btn-ghost btn-sm" id="fee-recalc">🔄 重新计算费用</button></div>',
      (needReview && order.lastExceptionNote ? [
        '  <div class="section-title">待复核异常</div>',
        '  <div style="background:#FFF7E6;border:1px solid #FFD591;border-radius:8px;padding:12px;margin-bottom:16px">',
        '    <div style="font-weight:600">v' + order.lastExceptionNote.version + ' ' + _e(order.lastExceptionNote.category) +
             '<span class="severity-tag severity-' + order.lastExceptionNote.severity + '" style="margin-left:8px">' + order.lastExceptionNote.severity + '</span></div>',
        '    <div style="font-size:12px;margin-top:4px">时间：' + (new Date(order.lastExceptionNote.createdAt)).toLocaleString() + '</div>',
        '  </div>',
      ].join('') : ''),
      '  <div class="form-group">',
      '    <label class="form-label required">复核意见 <span style="color:#CF1322">*</span></label>',
      '    <textarea id="finance-opinion" class="form-control" rows="3" placeholder="请填写复核意见（必填，5-200字）" style="resize:vertical"></textarea>',
      '  </div>',
      '  <div id="finance-err" style="color:#CF1322;font-size:12px;display:none"></div>',
      '</div>',
    ].join('');

    const footer = [
      '<button class="btn btn-ghost" id="finance-close">关闭</button>',
      needReview ? '<button class="btn btn-warn" id="finance-exception-reject">❌ 退回异常</button>' : '',
      needReview ? '<button class="btn btn-success" id="finance-exception-approve">✅ 异常通过</button>' : '',
      needVerify ? '<button class="btn btn-primary" id="finance-verify">✓ 确认收款</button>' : '',
      needRefund ? '<button class="btn btn-success" id="finance-refund">💰 确认退款 ¥' + refundAmount.toFixed(2) + '</button>' : '',
    ].join('');

    const close = _closeFn(_m(html, { title: '财务复核 - ' + order.code, size: 'lg', footerHtml: footer }));
    document.getElementById('finance-close').onclick = close;

    document.getElementById('fee-recalc').onclick = async function() {
      await DB.open();
      const o = await DB.get('orders', orderId);
      const newDetail = FeeEngine.recalculateOrder(o);
      o.feeDetail = newDetail;
      o.baseFee = newDetail.baseFee;
      o.weightFee = newDetail.weightFee;
      o.distanceFee = newDetail.distanceFee;
      o.nightFee = newDetail.nightFee;
      o.couponDiscount = newDetail.couponDiscount;
      o.finalTotal = newDetail.overweight && newDetail.overweight.confirmed ? newDetail.overweightTotal : newDetail.finalTotal;
      await DB.put('orders', o);
      await DB.put('feeCalculations', {
        id: 'FEE_' + o.id + '_' + Date.now(), orderId: o.id, detail: newDetail,
        recalculatedAt: new Date().toISOString(), recalculatedBy: user.id,
      });
      Audit.log(Audit.ACTIONS.FEE_RECALCULATED, orderId, { finalTotal: o.finalTotal });
      document.getElementById('finance-fee-box').innerHTML = _fb(newDetail);
      _t('重算完成', '费用已更新并保存版本', 'success');
    };

    const getOpinion = function() {
      const v = (document.getElementById('finance-opinion').value || '').trim();
      const err = document.getElementById('finance-err');
      if (v.length < 3) { err.textContent = '复核意见至少3个字'; err.style.display = 'block'; return null; }
      err.style.display = 'none';
      return v;
    };

    const actions = {
      'finance-verify': async () => {
        const opinion = getOpinion(); if (!opinion) return;
        await DB.open(); const o = await DB.get('orders', orderId);
        o.financeVerified = true; o.financeVerifiedAt = new Date().toISOString();
        o.financeVerifiedBy = user.id; o.financeOpinion = opinion;
        await DB.put('orders', o);
        Audit.log(Audit.ACTIONS.FINANCE_VERIFIED, orderId, { opinion: opinion });
        close(); _t('已确认', '收款已确认', 'success'); setTimeout(() => _nav('finance-review'), 300);
      },
      'finance-refund': async () => {
        const opinion = getOpinion(); if (!opinion) return;
        await DB.open(); const o = await DB.get('orders', orderId);
        o.refundAmount = refundAmount; o.refundedAt = new Date().toISOString();
        o.refundedBy = user.id; o.refundOpinion = opinion; o.refunded = true;
        await DB.put('orders', o);
        Audit.log(Audit.ACTIONS.FINANCE_REFUND_CONFIRMED, orderId, { amount: refundAmount, opinion: opinion });
        close(); _t('退款成功', '已退款 ¥' + refundAmount.toFixed(2), 'success'); setTimeout(() => _nav('finance-review'), 300);
      },
      'finance-exception-approve': async () => {
        const opinion = getOpinion(); if (!opinion) return;
        await DB.open(); const o = await DB.get('orders', orderId);
        o.financeReviewResult = 'approved'; o.financeReviewOpinion = opinion;
        o.financeReviewedAt = new Date().toISOString(); o.financeReviewedBy = user.id;
        const tr = StateMachine.transition(o, 'delivered', user, '异常通过：' + opinion);
        if (tr.success) { o.status = tr.order.status; o.statusHistory = tr.order.statusHistory; }
        await DB.put('orders', o);
        Audit.log(Audit.ACTIONS.FINANCE_EXCEPTION_APPROVED, orderId, { opinion: opinion });
        close(); _t('复核通过', '异常已通过，订单已完成', 'success'); setTimeout(() => _nav('finance-review'), 300);
      },
      'finance-exception-reject': async () => {
        const opinion = getOpinion(); if (!opinion) return;
        await DB.open(); const o = await DB.get('orders', orderId);
        o.financeReviewResult = 'rejected'; o.financeReviewOpinion = opinion;
        o.financeReviewedAt = new Date().toISOString(); o.financeReviewedBy = user.id;
        Audit.log(Audit.ACTIONS.FINANCE_EXCEPTION_REJECTED, orderId, { opinion: opinion });
        await DB.put('orders', o);
        close(); _t('已退回', '异常已退回处理', 'warn'); setTimeout(() => _nav('finance-review'), 300);
      },
    };
    Object.keys(actions).forEach(id => { const el = document.getElementById(id); if (el) el.onclick = actions[id]; });
  };

  // ========== 4. 审计日志弹窗 ==========
  Modals.showAuditLogs = async function(orderId) {
    await DB.open();
    const order = orderId ? await DB.get('orders', orderId) : null;
    const title = orderId ? ('订单审计链 - ' + order.code) : '系统审计日志（全量）';
    let logs = orderId ? (await Audit.exportForOrder(orderId)) : (await Audit.query({}));
    logs = logs.slice().sort((a, b) => (new Date(b.createdAt)) - (new Date(a.createdAt)));

    const html = [
      '<div class="modal-body">',
      '  <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center;flex-wrap:wrap">',
      '    <select id="audit-filter-action" class="form-control" style="max-width:180px;flex:0 0 auto"><option value="">全部动作</option></select>',
      '    <select id="audit-filter-level" class="form-control" style="max-width:140px;flex:0 0 auto">',
      '      <option value="">全部级别</option><option value="AUDIT">AUDIT</option>',
      '      <option value="INFO">INFO</option><option value="WARN">WARN</option><option value="ERROR">ERROR</option>',
      '    </select>',
      '    <input id="audit-filter-actor" class="form-control" placeholder="搜索操作人ID/姓名" style="max-width:180px;flex:1 1 auto">',
      '    <div style="margin-left:auto;font-size:12px;color:#8C8C8C">共 <b id="audit-count">' + logs.length + '</b> 条</div>',
      '  </div>',
      '  <div id="audit-list" style="max-height:60vh;overflow-y:auto;border:1px solid #F0F0F0;border-radius:6px"></div>',
      '</div>',
    ].join('');

    const footer = [
      '<button class="btn btn-ghost" id="audit-export">📤 导出 JSON</button>',
      '<button class="btn btn-primary" id="audit-close">关闭</button>',
    ].join('');

    const close = _closeFn(_m(html, { title: title, size: 'xl', footerHtml: footer }));
    document.getElementById('audit-close').onclick = close;

    const actions = Array.from(new Set(logs.map(l => l.action))).sort();
    const actionSel = document.getElementById('audit-filter-action');
    actions.forEach(a => { const opt = document.createElement('option'); opt.value = a; opt.textContent = a; actionSel.appendChild(opt); });

    const renderList = function(filtered) {
      document.getElementById('audit-count').textContent = filtered.length;
      if (filtered.length === 0) {
        document.getElementById('audit-list').innerHTML = '<div style="padding:30px;text-align:center;color:#BFBFBF">暂无审计日志</div>';
        return;
      }
      const items = [];
      for (let i = 0; i < filtered.length; i++) {
        const l = filtered[i];
        const parts = [];
        parts.push('<div style="padding:10px 12px;border-bottom:1px solid #F5F5F5;' + (i % 2 === 1 ? 'background:#FAFAFA;' : '') + '">');
        parts.push('  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">');
        parts.push('    <span class="audit-level-' + (l.level || 'INFO') + '" style="font-size:11px;padding:2px 6px;border-radius:4px;font-weight:600">' + (l.level || 'INFO') + '</span>');
        parts.push('    <span style="font-weight:600;font-size:13px">' + _e(l.action) + '</span>');
        parts.push('    <span style="font-size:11px;color:#8C8C8C">#' + String(filtered.length - i).padStart(4, '0') + '</span>');
        parts.push('    <span style="font-size:11px;color:#8C8C8C;margin-left:auto">' + (new Date(l.createdAt)).toLocaleString() + '</span>');
        parts.push('  </div>');
        parts.push('  <div style="font-size:12px;color:#595959;margin-bottom:4px;display:flex;gap:12px;flex-wrap:wrap">');
        parts.push('    <span>👤 ' + _e((l.actorName || l.actor || '?') + '（' + (l.role || '?') + '）') + '</span>');
        if (l.target) {
          parts.push('<span>🎯 ' + _e(String(l.target).slice(0, 60)) + '</span>');
        }
        parts.push('    <span>🆔 ' + _e(l.sessionId || '-') + '</span>');
        parts.push('  </div>');
        if (l.data && Object.keys(l.data).length > 0) {
          parts.push('  <details style="margin-top:6px">');
          parts.push('    <summary style="cursor:pointer;font-size:11px;color:#1890FF">查看数据载荷 ▸</summary>');
          parts.push('    <pre style="margin-top:6px;padding:8px;background:#F6F8FA;border-radius:4px;font-size:11px;overflow-x:auto;max-height:180px">' + _e(JSON.stringify(l.data, null, 2)) + '</pre>');
          parts.push('  </details>');
        }
        parts.push('</div>');
        items.push(parts.join(''));
      }
      document.getElementById('audit-list').innerHTML = items.join('');
    };

    renderList(logs);

    const applyFilter = function() {
      const a = document.getElementById('audit-filter-action').value;
      const lv = document.getElementById('audit-filter-level').value;
      const ak = (document.getElementById('audit-filter-actor').value || '').trim().toLowerCase();
      let f = logs.slice();
      if (a) f = f.filter(x => x.action === a);
      if (lv) f = f.filter(x => (x.level || 'INFO') === lv);
      if (ak) f = f.filter(x => ((x.actorName || '') + ' ' + (x.actor || '')).toLowerCase().indexOf(ak) >= 0);
      renderList(f);
    };
    ['audit-filter-action', 'audit-filter-level', 'audit-filter-actor'].forEach(id => {
      document.getElementById(id).addEventListener('change', applyFilter);
      document.getElementById(id).addEventListener('input', applyFilter);
    });

    document.getElementById('audit-export').onclick = async function() {
      const finalLogs = orderId ? (await Audit.exportForOrder(orderId)) : (await Audit.query({}));
      const data = {
        exportedAt: new Date().toISOString(),
        scope: orderId ? ('order:' + orderId) : 'system',
        orderCode: order ? order.code : null, count: finalLogs.length, logs: finalLogs,
      };
      _dl(data, 'audit-log-' + (orderId || 'system') + '-' + Date.now() + '.json');
      _t('导出成功', '共导出 ' + finalLogs.length + ' 条审计记录', 'success');
    };
  };

  global.Modals = Modals;
})(window);
