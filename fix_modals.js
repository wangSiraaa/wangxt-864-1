const fs = require('fs');
const path = 'public/js/ui/modals.js';
let content = fs.readFileSync(path, 'utf8');

const oldFuncStart = "    const renderList = function(filtered) {\n      document.getElementById('audit-count').textContent = filtered.length;\n      document.getElementById('audit-list').innerHTML = filtered.length === 0\n        ? '<div style=\"padding:30px;text-align:center;color:#BFBFBF\">暂无审计日志</div>'\n        : filtered.map((l, i) => [";

const newFunc = `    const renderList = function(filtered) {
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
        parts.push('    <span>👤 ' + _e((l.actorName || l.actor || '?') + '（' + (l.role || '?') + '）</span>');
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
    };`;

const endMarker = "    };\n    renderList(logs);";

if (content.includes(oldFuncStart) && content.includes(endMarker)) {
  const startIdx = content.indexOf(oldFuncStart);
  const endIdx = content.indexOf(endMarker, startIdx) + 7;
  const oldComplete = content.substring(startIdx, endIdx);
  content = content.substring(0, startIdx) + newFunc + content.substring(endIdx);
  fs.writeFileSync(path, content, 'utf8');
  console.log('SUCCESS: File updated!');
} else {
  console.log('ERROR: Could not find markers');
  console.log('Has start:', content.includes(oldFuncStart));
  console.log('Has end:', content.includes(endMarker));
}
