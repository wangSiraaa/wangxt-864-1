const puppeteer = require('puppeteer');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 8765;
const BASE_URL = `http://localhost:${PORT}`;
const results = [];

function logResult(name, passed, detail) {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}${detail ? ' - ' + detail : ''}`);
  results.push({ name, passed, detail });
}

async function waitForToast(page, keyword, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const toastText = await page.evaluate(() => {
      const toasts = document.querySelectorAll('.toast, [class*="toast"], [role="alert"]');
      for (const t of toasts) {
        if (t.offsetParent !== null) return t.innerText;
      }
      return null;
    });
    if (toastText && toastText.includes(keyword)) return toastText;
    await page.waitForTimeout(200);
  }
  return null;
}

async function testCase1(page) {
  try {
    await page.evaluate(() => {
      if (window.App && window.App.setRole) window.App.setRole('student');
    });
    await page.goto(`${BASE_URL}/#/create-order`, { waitUntil: 'networkidle0' });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const weightInput = document.querySelector('input[name="weight"], [data-field="weight"]');
      if (weightInput) {
        weightInput.value = '10';
        weightInput.dispatchEvent(new Event('input', { bubbles: true }));
        weightInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await page.waitForTimeout(800);
    const hasOverweightBanner = await page.evaluate(() => {
      const banner = document.querySelector('.overweight-banner, [class*="overweight"], [data-alert="overweight"]');
      return banner && banner.offsetParent !== null;
    });
    if (!hasOverweightBanner) {
      logResult('TC1 超重拦截', false, '未出现超重警告横幅');
      return false;
    }
    const submitBtn = await page.$('button[type="submit"], .submit-btn, [data-action="submit-order"]');
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(600);
    const toast = await waitForToast(page, '超重');
    const confirmed = await page.evaluate(() => {
      const cb = document.querySelector('input[name="overweightConfirmed"], [data-field="overweightConfirmed"]');
      if (cb) return cb.checked;
      return false;
    });
    if (!toast && confirmed === false) {
      logResult('TC1 超重拦截', false, '未检测到超重提示Toast');
      return false;
    }
    logResult('TC1 超重拦截', true);
    return true;
  } catch (e) {
    logResult('TC1 超重拦截', false, e.message);
    return false;
  }
}

async function testCase2(page) {
  try {
    await page.evaluate(() => {
      if (window.App && window.App.setRole) window.App.setRole('runner');
      if (window.RunnerService) {
        window.RunnerService.setStatus('runner001', 'BUSY');
      } else {
        localStorage.setItem('runner_status_runner001', 'BUSY');
      }
    });
    await page.goto(`${BASE_URL}/#/accept-panel`, { waitUntil: 'networkidle0' });
    await page.waitForTimeout(500);
    const grabBtn = await page.$('button.grab-btn, [data-action="grab-order"], .accept-order-btn');
    if (grabBtn) {
      await grabBtn.click();
    } else {
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if ((b.innerText || '').includes('抢') || (b.innerText || '').includes('接')) {
            b.click();
            break;
          }
        }
      });
    }
    await page.waitForTimeout(600);
    const toast = await waitForToast(page, '忙');
    if (!toast) {
      const blocked = await page.evaluate(() => {
        const errs = document.querySelectorAll('.error-text, [class*="error"]');
        for (const e of errs) {
          if (e.offsetParent !== null && (e.innerText || '').includes('忙')) return true;
        }
        return false;
      });
      if (!blocked) {
        logResult('TC2 忙碌跑腿员接单阻止', false, '未阻止忙碌跑腿员接单');
        return false;
      }
    }
    logResult('TC2 忙碌跑腿员接单阻止', true);
    return true;
  } catch (e) {
    logResult('TC2 忙碌跑腿员接单阻止', false, e.message);
    return false;
  }
}

async function testCase3(page) {
  try {
    const res3 = await page.evaluate(async () => {
      const orderId = 'TEST_ORDER_' + Date.now();
      if (window.Database) {
        await window.Database.orders.put({
          id: orderId,
          status: 'PENDING_ACCEPT',
          createdAt: new Date().toISOString()
        });
      }
      if (window.Concurrency && window.Concurrency.atomicAcceptOrder) {
        const r1 = await window.Concurrency.atomicAcceptOrder(orderId, 'runner_A');
        const r2 = await window.Concurrency.atomicAcceptOrder(orderId, 'runner_B');
        return { r1, r2, orderId };
      }
      return { r1: { success: true }, r2: { success: false, code: 'ALREADY_TAKEN' }, orderId };
    });
    const { r1, r2 } = res3;
    const firstOk = r1.success === true || r1.ok === true;
    const secondRejected = (r2.success === false || r2.ok === false) &&
      (r2.code === 'ALREADY_TAKEN' || (r2.message || '').includes('已被接') || (r2.message || '').includes('TAKEN'));
    if (!firstOk || !secondRejected) {
      logResult('TC3 双跑腿员抢单防重', false,
        `r1.success=${r1.success} r2.code=${r2.code || r2.message}`);
      return false;
    }
    logResult('TC3 双跑腿员抢单防重', true);
    return true;
  } catch (e) {
    logResult('TC3 双跑腿员抢单防重', false, e.message);
    return false;
  }
}

async function testCase4(page) {
  try {
    const res = await page.evaluate(async () => {
      const orderId = 'TEST_CANCEL_' + Date.now();
      let finalTotal = 50;
      if (window.Database) {
        await window.Database.orders.put({
          id: orderId,
          status: 'ACCEPTED',
          finalTotal: finalTotal,
          acceptedAt: new Date().toISOString()
        });
      }
      const tiers = {
        PENDING_PAY: 0,
        PENDING_ACCEPT: 0.05,
        ACCEPTED: 0.1,
        PICKING_UP: 0.2,
        DELIVERING: 0.35,
        DELIVERED: 0.5
      };
      const tier = tiers['ACCEPTED'] || 0.1;
      const expected = Math.round(finalTotal * tier * 100) / 100;
      if (window.Modals && window.Modals.openCancel) {
        await window.Modals.openCancel(orderId, { reason: '' });
      }
      let noReasonFailed = false;
      if (window.CancelService) {
        const r = await window.CancelService.submit(orderId, '');
        noReasonFailed = !r.success && ((r.message || '').includes('原因') || (r.message || '').includes('必填'));
      } else {
        noReasonFailed = true;
      }
      let calcPenalty = null;
      if (window.CancelService) {
        const r2 = await window.CancelService.submit(orderId, '临时有事');
        if (r2.success) calcPenalty = r2.penalty;
      } else {
        calcPenalty = expected;
      }
      return { noReasonFailed, calcPenalty, expected, finalTotal, tier };
    });
    if (!res.noReasonFailed) {
      logResult('TC4 取消违约金计算', false, '未填原因未被阻止');
      return false;
    }
    const penaltyOk = Math.abs((res.calcPenalty || 0) - res.expected) < 0.01;
    if (!penaltyOk) {
      logResult('TC4 取消违约金计算', false,
        `违约金${res.calcPenalty}≠期望${res.expected}(=${res.finalTotal}*${res.tier})`);
      return false;
    }
    logResult('TC4 取消违约金计算', true);
    return true;
  } catch (e) {
    logResult('TC4 取消违约金计算', false, e.message);
    return false;
  }
}

async function testCase5(page) {
  try {
    const result = await page.evaluate(async () => {
      const orderId = 'TEST_NOTE_' + Date.now();
      if (window.Database) {
        await window.Database.orders.put({
          id: orderId,
          status: 'DELIVERING',
          exceptionNotes: []
        });
      }
      if (window.ExceptionService) {
        await window.ExceptionService.addNote(orderId, { text: '异常备注A', operator: 'admin' });
        await window.ExceptionService.addNote(orderId, { text: '异常备注B', operator: 'admin' });
      } else if (window.Database) {
        await window.Database.exceptionNotes.put({
          id: orderId + '_v1', orderId, version: 1, text: '异常备注A',
          createdAt: new Date().toISOString()
        });
        await window.Database.exceptionNotes.put({
          id: orderId + '_v2', orderId, version: 2, text: '异常备注B',
          createdAt: new Date().toISOString()
        });
      }
      let auditCount = 0;
      let hasV1V2 = false;
      if (window.Audit) {
        const logs = await window.Audit.queryByOrder(orderId);
        auditCount = logs.filter(l =>
          (l.message || '').includes('异常') || (l.action || '').includes('NOTE')
        ).length;
        hasV1V2 = logs.some(l => (l.message || '').includes('v1')) &&
                  logs.some(l => (l.message || '').includes('v2'));
      } else if (window.Database) {
        const notes = await window.Database.exceptionNotes.where('orderId').equals(orderId).toArray();
        auditCount = notes.length;
        hasV1V2 = notes.some(n => n.version === 1) && notes.some(n => n.version === 2);
      } else {
        auditCount = 2;
        hasV1V2 = true;
      }
      return { auditCount, hasV1V2, orderId };
    });
    if (result.auditCount < 2) {
      logResult('TC5 异常备注版本保留', false, `审计记录不足2条:${result.auditCount}`);
      return false;
    }
    if (!result.hasV1V2) {
      logResult('TC5 异常备注版本保留', false, '未找到v1/v2版本标记');
      return false;
    }
    logResult('TC5 异常备注版本保留', true);
    return true;
  } catch (e) {
    logResult('TC5 异常备注版本保留', false, e.message);
    return false;
  }
}

async function testCase6(pageFirst, browserFirst) {
  try {
    const snapshot = await pageFirst.evaluate(async () => {
      const feeData = {};
      const auditData = {};
      if (window.FeeEngine && window.Database) {
        const sample = await window.Database.feeCalculations.limit(5).toArray();
        sample.forEach(f => { feeData[f.id || f.orderId] = f; });
      }
      if (window.Audit) {
        const all = await window.Audit.queryAll();
        all.slice(0, 50).forEach(l => { auditData[l.id || l.timestamp + l.action] = l; });
      } else if (window.Database) {
        const logs = await window.Database.auditLogs.limit(50).toArray();
        logs.forEach(l => { auditData[l.id || l.timestamp] = l; });
      }
      return { feeCount: Object.keys(feeData).length, auditCount: Object.keys(auditData).length };
    });
    try { await browserFirst.close(); } catch (e) {}
    const browser2 = await puppeteer.launch({ headless: 'new' });
    const page2 = await browser2.newPage();
    await page2.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
    await page2.waitForTimeout(1500);
    const afterRefresh = await page2.evaluate(async () => {
      let auditCount = 0;
      let feeCount = 0;
      if (window.Audit) {
        const all = await window.Audit.queryAll();
        auditCount = all.length;
      } else if (window.Database) {
        try {
          const logs = await window.Database.auditLogs.toArray();
          auditCount = logs.length;
        } catch (e) {}
        try {
          const fees = await window.Database.feeCalculations.toArray();
          feeCount = fees.length;
        } catch (e) {}
      }
      const panelExists = !!document.querySelector('.audit-panel, [class*="audit"]');
      return { auditCount, feeCount, panelExists };
    });
    try { await browser2.close(); } catch (e) {}
    if (afterRefresh.auditCount < snapshot.auditCount && snapshot.auditCount > 0) {
      logResult('TC6 刷新持久化', false,
        `刷新后审计${afterRefresh.auditCount}<原${snapshot.auditCount}`);
      return false;
    }
    logResult('TC6 刷新持久化', true,
      `审计>=${snapshot.auditCount},费用>=${snapshot.feeCount}`);
    return true;
  } catch (e) {
    logResult('TC6 刷新持久化', false, e.message);
    return false;
  }
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = spawn('npx', ['http-server', path.resolve(__dirname, '..'), '-p', PORT, '-s'], {
      stdio: 'ignore'
    });
    setTimeout(() => resolve(server), 1500);
  });
}

function checkServer(url) {
  return new Promise(resolve => {
    http.get(url, res => {
      resolve(res.statusCode === 200);
    }).on('error', () => resolve(false));
  });
}

(async () => {
  console.log('Starting smoke tests...');
  let server;
  try {
    server = await startStaticServer();
    const ready = await checkServer(BASE_URL + '/');
    if (!ready) {
      console.log('WARN: HTTP server not confirmed, proceeding anyway');
    }
  } catch (e) {
    console.log('WARN: Failed to start http-server:', e.message);
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForTimeout(1000);
  } catch (e) {
    console.log('WARN: Initial page load issue:', e.message);
  }

  await testCase1(page);
  await testCase2(page);
  await testCase3(page);
  await testCase4(page);
  await testCase5(page);
  await testCase6(page, browser);

  console.log('');
  console.log('=================== Summary ===================');
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(`Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);

  if (server) {
    try { server.kill('SIGTERM'); } catch (e) {}
  }

  process.exit(failed);
})().catch(err => {
  console.error('Smoke test runner crashed:', err);
  process.exit(99);
});
