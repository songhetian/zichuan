-- 置为库存需要独立的生命周期动作值：
-- 「归还」落回闲置（IDLE），「置为库存」落回仓库（IN_STOCK），两者目标状态不同，
-- 混用会让「生命周期」「操作日志」页无法区分，这里补一个枚举值。
ALTER TABLE `LifecycleLog` MODIFY `action` ENUM('CREATED', 'ALLOCATED', 'RETURNED', 'TRANSFERRED', 'UPGRADED', 'MAINTENANCE_START', 'MAINTENANCE_DONE', 'SCRAPPED', 'REPLACED', 'IN_STOCK') NOT NULL;
