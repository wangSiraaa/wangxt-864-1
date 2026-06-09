const Storage = (() => {
  const KEYS = {
    CURRENT_ROLE: 'ce_current_role',
    CURRENT_USER: 'ce_current_user',
    SESSION_ID: 'ce_session_id',
    LAST_FILTERS: 'ce_last_filters',
    RUNNER_BUSY_STATE: 'ce_runner_busy_state',
    UI_PREFERENCES: 'ce_ui_prefs',
    LAST_SYNC: 'ce_last_sync',
    VIEW_STATE: 'ce_view_state',
    COMPARE_CANDIDATES: 'ce_compare_candidates'
  };

  function safeGet(key, defaultValue = null) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return defaultValue;
      return JSON.parse(raw);
    } catch (e) {
      return defaultValue;
    }
  }

  function safeSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('localStorage 写入失败:', key, e);
      return false;
    }
  }

  function safeRemove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getCurrentRole() {
    return safeGet(KEYS.CURRENT_ROLE, Models.ROLES.STUDENT);
  }

  function setCurrentRole(role) {
    return safeSet(KEYS.CURRENT_ROLE, role);
  }

  function getCurrentUser() {
    return safeGet(KEYS.CURRENT_USER, {
      id: 'student_demo_1',
      name: '小明',
      role: Models.ROLES.STUDENT
    });
  }

  function setCurrentUser(user) {
    return safeSet(KEYS.CURRENT_USER, user);
  }

  function getSessionId() {
    let sid = localStorage.getItem(KEYS.SESSION_ID);
    if (!sid) {
      sid = Models.generateId('sess_');
      localStorage.setItem(KEYS.SESSION_ID, sid);
    }
    return sid;
  }

  function getLastFilters(pageKey = 'default') {
    const all = safeGet(KEYS.LAST_FILTERS, {});
    return all[pageKey] || {};
  }

  function setLastFilters(pageKey, filters) {
    const all = safeGet(KEYS.LAST_FILTERS, {});
    all[pageKey] = filters;
    all[pageKey]._savedAt = Date.now();
    return safeSet(KEYS.LAST_FILTERS, all);
  }

  function getRunnerBusyState(runnerId = null) {
    const all = safeGet(KEYS.RUNNER_BUSY_STATE, {});
    if (runnerId) return all[runnerId] || { isBusy: false };
    return all;
  }

  function setRunnerBusyState(runnerId, state) {
    const all = safeGet(KEYS.RUNNER_BUSY_STATE, {});
    all[runnerId] = { ...state, _updatedAt: Date.now() };
    return safeSet(KEYS.RUNNER_BUSY_STATE, all);
  }

  function getUiPreferences() {
    return safeGet(KEYS.UI_PREFERENCES, {
      logPanelCollapsed: false,
      logLevel: 'all',
      theme: 'light',
      density: 'normal'
    });
  }

  function setUiPreferences(prefs) {
    const merged = { ...getUiPreferences(), ...prefs };
    return safeSet(KEYS.UI_PREFERENCES, merged);
  }

  function getViewState(key) {
    const all = safeGet(KEYS.VIEW_STATE, {});
    return all[key] || null;
  }

  function setViewState(key, state) {
    const all = safeGet(KEYS.VIEW_STATE, {});
    all[key] = { ...state, _savedAt: Date.now() };
    return safeSet(KEYS.VIEW_STATE, all);
  }

  function exportAll() {
    const result = {
      timestamp: Date.now(),
      localStorage: {},
      version: 1
    };
    Object.keys(KEYS).forEach(k => {
      result.localStorage[k] = safeGet(KEYS[k], null);
    });
    return result;
  }

  function importAll(data) {
    if (!data || !data.localStorage) return false;
    Object.keys(data.localStorage).forEach(k => {
      if (data.localStorage[k] !== null && data.localStorage[k] !== undefined) {
        localStorage.setItem(k, JSON.stringify(data.localStorage[k]));
      }
    });
    return true;
  }

  function clearAllLocal() {
    Object.keys(KEYS).forEach(k => safeRemove(KEYS[k]));
    return true;
  }

  function getCompareCandidates(userId) {
    const all = safeGet(KEYS.COMPARE_CANDIDATES, {});
    const key = userId || 'default';
    return all[key] || [];
  }

  function setCompareCandidates(userId, ids) {
    const all = safeGet(KEYS.COMPARE_CANDIDATES, {});
    const key = userId || 'default';
    all[key] = Array.from(new Set(ids || []));
    return safeSet(KEYS.COMPARE_CANDIDATES, all);
  }

  function addCompareCandidate(userId, orderId) {
    const current = getCompareCandidates(userId);
    if (current.indexOf(orderId) < 0) {
      current.push(orderId);
    }
    return setCompareCandidates(userId, current);
  }

  function removeCompareCandidate(userId, orderId) {
    const current = getCompareCandidates(userId);
    const idx = current.indexOf(orderId);
    if (idx >= 0) {
      current.splice(idx, 1);
    }
    return setCompareCandidates(userId, current);
  }

  function toggleCompareCandidate(userId, orderId) {
    const current = getCompareCandidates(userId);
    const idx = current.indexOf(orderId);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(orderId);
    }
    return setCompareCandidates(userId, current);
  }

  function clearCompareCandidates(userId) {
    return setCompareCandidates(userId, []);
  }

  function isCompareCandidate(userId, orderId) {
    const current = getCompareCandidates(userId);
    return current.indexOf(orderId) >= 0;
  }

  return {
    KEYS,
    getCurrentRole,
    setCurrentRole,
    getCurrentUser,
    setCurrentUser,
    getSessionId,
    getLastFilters,
    setLastFilters,
    getRunnerBusyState,
    setRunnerBusyState,
    getUiPreferences,
    setUiPreferences,
    getViewState,
    setViewState,
    getCompareCandidates,
    setCompareCandidates,
    addCompareCandidate,
    removeCompareCandidate,
    toggleCompareCandidate,
    clearCompareCandidates,
    isCompareCandidate,
    exportAll,
    importAll,
    clearAllLocal,
    raw: {
      get: safeGet,
      set: safeSet,
      remove: safeRemove
    }
  };
})();
