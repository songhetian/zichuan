-- 收敛状态模型：设备只保留一个「可分配池」——「闲置」(IDLE)。
--
-- 起因：「库存」(IN_STOCK) 与「闲置」在系统里行为完全一致 —— 都无使用人、都能被
-- 直接分配（分配守卫 status in ["IDLE","IN_STOCK"]），区别只有名称与落点。
-- 两个状态并存只带来解释成本，且「库存」一词与「配件库存」撞名，容易混淆。
-- 因此把 IN_STOCK 全部并入 IDLE，并从枚举中移除。
--
-- 注意：必须先转换存量数据，再缩枚举，否则 ALTER 会因存在非法值而失败。

-- 1) 存量数据转换：所有引用 AssetStatus 的列
UPDATE `Asset` SET `status` = 'IDLE' WHERE `status` = 'IN_STOCK';
UPDATE `Asset` SET `reservedFromStatus` = 'IDLE' WHERE `reservedFromStatus` = 'IN_STOCK';
UPDATE `LifecycleLog` SET `fromStatus` = 'IDLE' WHERE `fromStatus` = 'IN_STOCK';
UPDATE `LifecycleLog` SET `toStatus` = 'IDLE' WHERE `toStatus` = 'IN_STOCK';
UPDATE `StocktakeRecord` SET `expectedStatus` = 'IDLE' WHERE `expectedStatus` = 'IN_STOCK';

-- 2) 历史生命周期动作并入「归还」：两者语义都是"回到可分配池"
UPDATE `LifecycleLog` SET `action` = 'RETURNED' WHERE `action` = 'IN_STOCK';

-- 3) 缩枚举
ALTER TABLE `Asset`
    MODIFY `status` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'RESERVED') NOT NULL DEFAULT 'IDLE',
    MODIFY `reservedFromStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'RESERVED') NULL;

ALTER TABLE `LifecycleLog`
    MODIFY `fromStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'RESERVED') NULL,
    MODIFY `toStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'RESERVED') NULL,
    MODIFY `action` ENUM('CREATED', 'ALLOCATED', 'RETURNED', 'TRANSFERRED', 'UPGRADED', 'MAINTENANCE_START', 'MAINTENANCE_DONE', 'SCRAPPED', 'REPLACED') NOT NULL;

ALTER TABLE `StocktakeRecord`
    MODIFY `expectedStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'RESERVED') NOT NULL;
