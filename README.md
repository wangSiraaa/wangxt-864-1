# 校园跑腿订单小票台（高复杂度离线 Web 前端）

- 纯前端离线SPA：HTML/CSS/原生JS，无框架依赖，IndexedDB + localStorage 持久化
- 4 角色 RBAC：下单学生、跑腿员、管理员、财务复核员
- 订单状态机：待支付 → 待接单 → 已接单 → 取货中 → 配送中 → 已送达 / 已取消 / 异常复核（不可跳状态）
- 费用引擎：基础费 + 重量阶梯费（5档）+ 距离阶梯费（5档）+ 夜间费（22:00-06:00）+ 优惠券互斥组 + 取消违约金（8档）
- 超重拦截：3kg以上每公斤加2元，需确认加价才能下单
- 并发防重：PK锁 + 幂等缓存 + DB原子事务；抢单/取消/财务复核均防重
- 审计：订阅模式日志流、右侧实时日志面板、按级别过滤、JSON导出、订单级审计链可复查
- 持久化：8 个 IndexedDB store（orders/runners/coupons/auditLogs/locks/exceptionNotes/cancelRecords/feeCalculations）+ 9 个 localStorage 命名空间

## 目录结构

- public/: 前端资源
- public/js/core/: 数据层、费用引擎、状态机、并发锁、角色权限、审计、存储
- public/js/ui/: 组件、页面、弹窗、入口app.js
- public/css/: 样式
- server.js: Node 静态服务器
- tests/smoke.js: Puppeteer 冒烟测试

## 启动

1. npm install
2. npm start → http://localhost:8080
3. Docker: docker-compose up -d
4. Smoke测试: npm run smoke（无头Puppeteer覆盖6个用例）

## 要求覆盖的6个 Smoke 用例

1. 未确认超重加价不能下单
2. 忙碌跑腿员接单被阻止
3. 双跑腿员抢单只成功一次
4. 取消不填原因失败且填写后生成正确违约金
5. 异常备注版本保留
6. 刷新后费用明细和审计日志仍存在
