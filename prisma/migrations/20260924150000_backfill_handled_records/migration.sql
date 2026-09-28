-- ============================================================
-- 「我办理的记录」历史数据回填
--   1) ApprovalRequest.componentCategoryId：从 payload.componentCategoryId 冗余（升级 / 加购才有）
--   2) 存量 EXECUTE 日志归因：actorId 为空（旧版自动执行 / 离职交接未归因）→ 补给同单最后一条 APPROVE 的审批人
--   3) 补齐缺失的 EXECUTE 日志（旧版手动执行函数未写日志）：
--      3a 人工执行（资产操作日志有 operatorId）→ 执行人 = 操作账号
--      3b 其余（自动执行 / 离职交接）→ 归因给同单最后一条 APPROVE 的审批人
-- 「最后一条 APPROVE」以自增 id 最大者为准（日志按时间顺序追加，id 与 createdAt 同序）
-- 幂等：全部带 NOT EXISTS / actorId IS NULL 守卫，重复执行不会产生重复日志
-- ============================================================

-- 1) 冗余配件类型（仅升级 / 加购业务；payload 中该键非数值的一律跳过）
UPDATE `ApprovalRequest`
SET `componentCategoryId` = CAST(JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.componentCategoryId')) AS UNSIGNED)
WHERE `componentCategoryId` IS NULL
  AND `businessType` IN ('ASSET_UPGRADE', 'ASSET_PURCHASE')
  AND JSON_TYPE(JSON_EXTRACT(`payload`, '$.componentCategoryId')) IN ('INTEGER', 'DOUBLE', 'DECIMAL');

-- 2) 存量 actorId 为空的 EXECUTE 日志 → 归因给同单最后一条 APPROVE 的审批人
UPDATE `ApprovalLog` al
JOIN (
  SELECT `requestId`, MAX(`id`) AS `lastApproveId`
  FROM `ApprovalLog`
  WHERE `action` = 'APPROVE' AND `actorId` IS NOT NULL
  GROUP BY `requestId`
) t ON t.`requestId` = al.`requestId`
JOIN `ApprovalLog` src ON src.`id` = t.`lastApproveId`
SET al.`actorId` = src.`actorId`
WHERE al.`action` = 'EXECUTE' AND al.`actorId` IS NULL;

-- 3a) 人工执行补齐：有资产操作日志（带操作账号）但无 EXECUTE 日志的已通过单
INSERT INTO `ApprovalLog` (`requestId`, `actorId`, `action`, `fromNodeKey`, `toNodeKey`, `comment`, `createdAt`)
SELECT
  r.`id`,
  l.`operatorId`,
  'EXECUTE',
  NULL,
  NULL,
  '历史数据回填：执行动作归因（手动执行人）',
  COALESCE(r.`executedAt`, r.`finishedAt`, r.`updatedAt`)
FROM `ApprovalRequest` r
JOIN (
  SELECT `requestId`, MAX(`id`) AS `lastId`
  FROM `LifecycleLog`
  WHERE `requestId` IS NOT NULL AND `operatorId` IS NOT NULL
  GROUP BY `requestId`
) t ON t.`requestId` = r.`id`
JOIN `LifecycleLog` l ON l.`id` = t.`lastId`
WHERE r.`status` = 'APPROVED'
  AND NOT EXISTS (
    SELECT 1 FROM `ApprovalLog` al WHERE al.`requestId` = r.`id` AND al.`action` = 'EXECUTE'
  );

-- 3b) 自动执行 / 离职交接补齐：有资产操作日志但无 EXECUTE 日志的已通过单 → 归因终审审批人
INSERT INTO `ApprovalLog` (`requestId`, `actorId`, `action`, `fromNodeKey`, `toNodeKey`, `comment`, `createdAt`)
SELECT
  r.`id`,
  src.`actorId`,
  'EXECUTE',
  NULL,
  NULL,
  '历史数据回填：执行动作归因（终审审批人）',
  COALESCE(r.`finishedAt`, r.`updatedAt`)
FROM `ApprovalRequest` r
JOIN (
  SELECT DISTINCT `requestId` FROM `LifecycleLog` WHERE `requestId` IS NOT NULL
) lv ON lv.`requestId` = r.`id`
JOIN (
  SELECT `requestId`, MAX(`id`) AS `lastApproveId`
  FROM `ApprovalLog`
  WHERE `action` = 'APPROVE' AND `actorId` IS NOT NULL
  GROUP BY `requestId`
) t ON t.`requestId` = r.`id`
JOIN `ApprovalLog` src ON src.`id` = t.`lastApproveId`
WHERE r.`status` = 'APPROVED'
  AND NOT EXISTS (
    SELECT 1 FROM `ApprovalLog` al WHERE al.`requestId` = r.`id` AND al.`action` = 'EXECUTE'
  );

-- 明细日志：记录本次回填结果，便于事后核查
INSERT INTO `SystemLog` (`module`, `action`, `detail`, `operator`, `createdAt`)
SELECT
  '数据迁移',
  'BACKFILL',
  CONCAT(
    '「我办理的记录」历史回填：配件类型冗余 ',
    (SELECT COUNT(*) FROM `ApprovalRequest` WHERE `businessType` IN ('ASSET_UPGRADE', 'ASSET_PURCHASE') AND `componentCategoryId` IS NOT NULL),
    ' 条；执行日志共 ',
    (SELECT COUNT(*) FROM `ApprovalLog` WHERE `action` = 'EXECUTE'),
    ' 条，其中已归因 ',
    (SELECT COUNT(*) FROM `ApprovalLog` WHERE `action` = 'EXECUTE' AND `actorId` IS NOT NULL),
    ' 条，仍无归属（展示为「系统执行」）',
    (SELECT COUNT(*) FROM `ApprovalLog` WHERE `action` = 'EXECUTE' AND `actorId` IS NULL),
    ' 条'
  ),
  'system',
  NOW();