window.App = {
  currentPage: null,
  logBuffer: [],
  renderPage: null,
  refreshHeader: null,
  exportAll: null,
  __forceFree: null
};

(function () {
  var logBuffer = App.logBuffer;
  var defaultPageMap = {
    student: 'order_list_student',
    runner: 'order_pool',
    admin: 'all_orders',
    finance: 'finance_review'
  };

  function getDefaultPage(role) {
    return defaultPageMap[role] || 'order_list_student';
  }

  function updateHeader() {
    var role = Storage.getCurrentRole();
    var user = Storage.getCurrentUser();
    var nameEl = document.getElementById('currentUserName');
    if (nameEl) {
      nameEl.textContent = user.name + ' · ' + Models.ROLE_LABELS[role];
    }
    var btns = document.querySelectorAll('.role-btn');
    btns.forEach(function (btn) {
      var r = btn.getAttribute('data-role');
      btn.classList.toggle('active', r === role);
    });
    var badge = document.getElementById('statusBadge');
    if (badge) {
      var isOnline = navigator.onLine;
      badge.textContent = isOnline ? '🟢 在线' : '🔴 离线';
      badge.className = 'env-badge ' + (isOnline ? 'online' : 'offline');
    }
  }

  function bindTopBar() {
    var btns = document.querySelectorAll('.role-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var r = btn.getAttribute('data-role');
        try {
          Roles.switchRole(r);
        } catch (e) {
          UI.showToast('切换失败', e.message, 'error');
          return;
        }
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        updateHeader();
        var currentRole = Storage.getCurrentRole();
        UI.renderSideNav(currentRole, getDefaultPage(currentRole));
        ensureBusyBanner();
        App.renderPage(getDefaultPage(currentRole));
        UI.showToast('角色已切换', '当前：' + Models.ROLE_LABELS[r], 'success');
      });
    });
    var auditBtn = document.getElementById('openAuditBtn');
    if (auditBtn) {
      auditBtn.addEventListener('click', function () {
        Modals.showAuditLogs(null);
      });
    }
    var exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        App.exportAll();
      });
    }
  }

  function bindLogPanel() {
    var clearBtn = document.getElementById('clearLogBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        logBuffer.length = 0;
        UI.renderLogPanel(logBuffer);
      });
    }
    var filter = document.getElementById('logLevelFilter');
    if (filter) {
      filter.addEventListener('change', function () {
        UI.renderLogPanel(logBuffer);
      });
    }
  }

  function ensureBusyBanner() {
    var role = Storage.getCurrentRole();
    var user = Storage.getCurrentUser();
    var existing = document.getElementById('busyBanner');
    if (role !== Models.ROLES.RUNNER) {
      if (existing) existing.remove();
      return;
    }
    var runnerId = user.id;
    var busyState = Storage.getRunnerBusyState(runnerId);
    var topbar = document.querySelector('.topbar');
    if (!busyState || !busyState.isBusy) {
      if (existing) existing.remove();
      return;
    }
    if (!existing) {
      existing = document.createElement('div');
      existing.id = 'busyBanner';
      existing.className = 'busy-banner';
      if (topbar) {
        topbar.parentNode.insertBefore(existing, topbar.nextSibling);
      } else {
        document.body.insertBefore(existing, document.body.firstChild);
      }
    }
    DB.open().then(function () {
      return DB.getAll(DB.STORES.orders);
    }).then(function (orders) {
      var myOrder = orders.find(function (o) {
        return o.runnerId === runnerId &&
          [Models.ORDER_STATUSES.ACCEPTED, Models.ORDER_STATUSES.PICKING, Models.ORDER_STATUSES.DELIVERING].indexOf(o.status) >= 0;
      });
      var orderCode = myOrder ? myOrder.code : (busyState.reason || '无');
      existing.innerHTML =
        '<div class="busy-banner-content">' +
          '<span class="busy-banner-icon">⏸️</span>' +
          '<span class="busy-banner-text">当前忙碌 · 订单号：<b>' + UI.escapeHtml(orderCode) + '</b></span>' +
          '<button class="btn btn-sm btn-success" onclick="App.__forceFree()">🔓 强制解除忙碌</button>' +
        '</div>';
    }).catch(function () {
      existing.innerHTML =
        '<div class="busy-banner-content">' +
          '<span class="busy-banner-icon">⏸️</span>' +
          '<span class="busy-banner-text">当前忙碌</span>' +
          '<button class="btn btn-sm btn-success" onclick="App.__forceFree()">🔓 强制解除忙碌</button>' +
        '</div>';
    });
  }

  function updateBusyBanner() {
    ensureBusyBanner();
  }

  function renderPage(pageKey, params) {
    App.currentPage = pageKey;
    var role = Storage.getCurrentRole();
    UI.renderSideNav(role, pageKey);
    updateHeader();
    var container = document.getElementById('pageContent');
    if (!container) return;
    var def = Pages.PAGE_MAP[pageKey];
    if (!def) {
      container.innerHTML = '<div class="empty-state"><div class="icon">❓</div><div class="text">页面未找到：' + UI.escapeHtml(pageKey) + '</div></div>';
      return;
    }
    container.innerHTML = UI.loadingHtml('正在加载...');
    Promise.resolve(def.render(params)).then(function (html) {
      container.innerHTML = html;
      if (typeof def.bind === 'function') {
        try { def.bind(params); } catch (e) { console.warn('Page bind error:', pageKey, e); }
      }
    }).catch(function (e) {
      container.innerHTML = '<div class="empty-state"><div class="icon">❌</div><div class="text">加载失败：' + UI.escapeHtml(e.message || String(e)) + '</div></div>';
    });
  }

  function forceFree() {
    var role = Storage.getCurrentRole();
    if (role !== Models.ROLES.RUNNER) {
      UI.showToast('仅跑腿员可用', '', 'warning');
      return;
    }
    var user = Storage.getCurrentUser();
    var runnerId = user.id;
    Storage.setRunnerBusyState(runnerId, { isBusy: false, reason: null });
    Audit.log(Audit.ACTIONS.RUNNER_BUSY_CLEAR, runnerId, { reason: 'force_free' }, 'AUDIT');
    DB.open().then(function () {
      return DB.getAll(DB.STORES.runners);
    }).then(function (runners) {
      var me = runners.find(function (r) { return r.id === runnerId; });
      if (me) {
        me.isBusy = false;
        me.busyReason = null;
        me.busySince = null;
        return DB.put(DB.STORES.runners, me);
      }
    }).then(function () {
      updateBusyBanner();
      if (App.currentPage === 'order_pool') {
        renderPage('order_pool');
      }
      UI.showToast('已解除忙碌', '可以接单了', 'success');
    }).catch(function (e) {
      updateBusyBanner();
      UI.showToast('部分失败', e.message || String(e), 'warning');
    });
  }

  function doExport() {
    var storeNames = [
      DB.STORES.orders, DB.STORES.runners, DB.STORES.coupons, DB.STORES.auditLogs,
      DB.STORES.locks, DB.STORES.exceptionNotes, DB.STORES.cancelRecords, DB.STORES.feeCalculations
    ];
    var data = {
      exportedAt: Date.now(),
      exportedBy: Storage.getCurrentUser(),
      version: 1,
      indexedDB: {},
      localStorage: null
    };
    DB.open().then(function () {
      var ps = storeNames.map(function (name) {
        return DB.getAll(name).then(function (rows) {
          data.indexedDB[name] = rows;
        });
      });
      return Promise.all(ps);
    }).then(function () {
      data.localStorage = Storage.exportAll();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'campus-runner-export-' + ts + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
      }, 100);
      Audit.log(Audit.ACTIONS.EXPORT_DATA, 'SYSTEM', { storeCount: storeNames.length, timestamp: ts }, 'AUDIT');
      UI.showToast('导出成功', '已下载 JSON 快照', 'success');
    }).catch(function (e) {
      UI.showToast('导出失败', e.message || String(e), 'error');
    });
  }

  function init() {
    DB.open().then(function () {
      return Pages.seedTestData();
    }).then(function () {
      if (!Storage.getCurrentRole()) {
        Roles.switchRole(Models.ROLES.STUDENT);
      }
      bindTopBar();
      bindLogPanel();
      Audit.subscribe(function (log) {
        logBuffer.unshift(log);
        if (logBuffer.length > 500) logBuffer.length = 500;
        UI.renderLogPanel(logBuffer);
      });
      return Audit.query({});
    }).then(function (existingLogs) {
      if (existingLogs && existingLogs.length > 0) {
        logBuffer.length = 0;
        existingLogs.slice(0, 500).forEach(function (l) { logBuffer.push(l); });
        UI.renderLogPanel(logBuffer);
      }
      updateHeader();
      var currentRole = Storage.getCurrentRole();
      UI.renderSideNav(currentRole, getDefaultPage(currentRole));
      ensureBusyBanner();
      renderPage(getDefaultPage(currentRole));
      window.addEventListener('online', function () { updateHeader(); });
      window.addEventListener('offline', function () { updateHeader(); });
    }).catch(function (e) {
      console.error('App init failed:', e);
      var container = document.getElementById('pageContent');
      if (container) {
        container.innerHTML = '<div class="empty-state"><div class="icon">💥</div><div class="text">初始化失败：' + UI.escapeHtml(e.message || String(e)) + '</div></div>';
      }
    });
  }

  App.renderPage = renderPage;
  App.refreshHeader = updateHeader;
  App.exportAll = doExport;
  App.__forceFree = forceFree;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
