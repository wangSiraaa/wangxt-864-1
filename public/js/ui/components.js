const UI = (() => {
  function showToast(title, desc, type) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const icons = { success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'info');
    toast.innerHTML =
      '<span class="toast-icon">' + (icons[type || 'info'] || 'ℹ️') + '</span>' +
      '<div class="toast-content">' +
        '<div class="toast-title">' + title + '</div>' +
        (desc ? '<div class="toast-desc">' + desc + '</div>' : '') +
      '</div>';
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function openModal(htmlContent, opts) {
    const root = document.getElementById('modalRoot');
    if (!root) return null;
    opts = opts || {};
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal ' + (opts.size === 'small' ? 'small' : opts.size === 'large' ? 'large' : '') + '">' +
        (opts.title ? '<div class="modal-header"><div class="modal-title">' + opts.title + '</div>' +
          '<button class="modal-close" data-action="close-modal">&times;</button></div>' : '') +
        '<div class="modal-body">' + htmlContent + '</div>' +
        (opts.footerHtml ? '<div class="modal-footer">' + opts.footerHtml + '</div>' : '') +
      '</div>';
    root.appendChild(overlay);
    const close = function() { overlay.remove(); };
    overlay.querySelectorAll('[data-action="close-modal"]').forEach(b => {
      b.addEventListener('click', close);
    });
    overlay.addEventListener('click', e => {
      if (e.target === overlay && opts.closeOnOverlay !== false) close();
    });
    return { el: overlay, close, body: overlay.querySelector('.modal-body') };
  }

  function closeAllModals() {
    const root = document.getElementById('modalRoot');
    if (root) root.innerHTML = '';
  }

  function renderSideNav(role, activePage) {
    const nav = document.getElementById('sideNav');
    if (!nav) return;
    const groups = Roles.getRoleNavItems(role);
    let html = '';
    Object.keys(groups).forEach(gName => {
      html += '<div class="nav-group"><div class="nav-group-title">' + gName + '</div>';
      groups[gName].forEach(item => {
        html += '<div class="nav-item ' + (activePage === item.page ? 'active' : '') +
          '" data-page="' + item.page + '">' +
          '<span>' + item.icon + '</span><span>' + item.label + '</span></div>';
      });
      html += '</div>';
    });
    nav.innerHTML = html;
    nav.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => {
        const p = el.getAttribute('data-page');
        if (typeof window.App !== 'undefined' && App.renderPage) {
          App.renderPage(p);
        }
      });
    });
  }

  function formatMoney(n) {
    return '¥' + (Number(n || 0).toFixed(2));
  }

  function formatTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function formatTimeShort(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function statusBadge(status) {
    const label = Models.STATUS_LABELS[status] || status;
    return '<span class="status-badge status-' + status + '">' + label + '</span>';
  }

  function feeBreakdown(detail, opts) {
    opts = opts || {};
    const lines = FeeEngine.formatFeeDisplay(detail);
    let html = '<div class="fee-breakdown">';
    lines.forEach(l => {
      html += '<div class="fee-item ' + (l.isDiscount ? 'discount' : '') + '">' +
        '<span>' + l.label + '</span>' +
        '<span class="font-mono ' + (l.isDiscount ? 'text-success' : l.isOverweight ? 'text-warning' : '') + '">' +
          (l.isDiscount ? '-' : l.isOverweight ? '+' : '') + formatMoney(Math.abs(parseFloat(l.amount.replace(/[^\d.-]/g, '') || 0))) +
        '</span></div>';
    });
    html += '<div class="fee-total"><span>' + (opts.totalLabel || '实付金额') + '</span>' +
      '<span class="amount">' + formatMoney(detail.overweight && detail.overweight.required ? detail.overweightTotal : detail.finalTotal) +
      '</span></div></div>';
    return html;
  }

  function orderTimeline(order) {
    const flow = StateMachine.getStatusFlow();
    const info = StateMachine.getStatusNodeInfo(order.status, order);
    let html = '<div class="timeline">';
    flow.forEach((st, idx) => {
      const timeMap = {
        pending_payment: order.createdAt,
        pending_accept: order.paidAt,
        accepted: order.acceptedAt,
        picking: order.pickedAt,
        delivering: order.deliveringAt,
        delivered: order.deliveredAt
      };
      let cls = '';
      let title = Models.STATUS_LABELS[st];
      let desc = '';
      if (info.currentIndex >= 0 && idx < info.currentIndex) {
        cls = 'done';
        desc = '已完成';
      } else if (idx === info.currentIndex && !info.isException) {
        cls = 'active';
        desc = '进行中';
      }
      if (idx === info.currentIndex && order.exceptionNote) {
        desc = order.exceptionNote;
      }
      const t = timeMap[st];
      html += '<div class="timeline-item ' + cls + '">' +
        '<div class="timeline-time">' + (t ? formatTimeShort(t) : '--:--') + '</div>' +
        '<div class="timeline-title">' + title + '</div>' +
        (desc ? '<div class="timeline-desc">' + desc + '</div>' : '') +
      '</div>';
    });
    if (info.isException) {
      html += '<div class="timeline-item active">' +
        '<div class="timeline-time">' + formatTimeShort(order.updatedAt) + '</div>' +
        '<div class="timeline-title text-warning">异常处理中</div>' +
        (order.exceptionNote ? '<div class="timeline-desc">' + order.exceptionNote + '</div>' : '') +
      '</div>';
    }
    if (order.status === Models.ORDER_STATUSES.CANCELLED) {
      html += '<div class="timeline-item done">' +
        '<div class="timeline-time">' + formatTimeShort(order.cancelledAt) + '</div>' +
        '<div class="timeline-title text-danger">已取消</div>' +
        (order.cancelReason ? '<div class="timeline-desc">' + order.cancelReason + '</div>' : '') +
      '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderLogPanel(logs) {
    const list = document.getElementById('logList');
    if (!list) return;
    const filter = document.getElementById('logLevelFilter');
    const level = filter ? filter.value : 'all';
    let html = '';
    const showLogs = (logs || []).filter(l => {
      if (level === 'all') return true;
      return l.level === level;
    });
    showLogs.forEach(l => {
      html += '<div class="log-item">' +
        '<div class="log-time">' + formatTime(l.timestamp) +
          ' · <span class="text-muted">' + (l.actorName || l.actor) + '</span>' +
          ' · <span class="text-muted">' + l.action + '</span></div>' +
        '<div><span class="log-level ' + l.level + '">' + l.level + '</span>' +
        '<span class="log-msg">' + (l.data && l.data.message ? l.data.message : l.action.replace(/_/g, ' ')) +
        '</span></div>';
      if (l.data && Object.keys(l.data).length > 0) {
        try {
          const s = JSON.stringify(l.data, null, 2);
          if (s && s.length < 500) {
            html += '<div class="log-details">' + escapeHtml(s) + '</div>';
          }
        } catch (_) {}
      }
      html += '</div>';
    });
    if (showLogs.length === 0) {
      html = '<div class="empty-state"><div class="icon">📝</div><div class="text">暂无日志记录</div></div>';
    }
    list.innerHTML = html;
    list.scrollTop = 0;
  }

  function escapeHtml(s) {
    if (typeof s !== 'string') return String(s);
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function loadingHtml(text) {
    return '<div class="flex-center" style="padding:40px;color:var(--text-muted)">' +
      '<span style="animation: pulse 1s infinite">⏳</span> ' +
      '<span style="margin-left:8px">' + (text || '加载中...') + '</span></div>';
  }

  return {
    showToast,
    openModal,
    closeAllModals,
    renderSideNav,
    formatMoney,
    formatTime,
    formatTimeShort,
    statusBadge,
    feeBreakdown,
    orderTimeline,
    renderLogPanel,
    escapeHtml,
    loadingHtml
  };
})();
