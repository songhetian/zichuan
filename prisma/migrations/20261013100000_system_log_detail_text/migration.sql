-- 系统日志详情扩容：VARCHAR(191) → TEXT
--
-- 起因：SystemLog.detail 默认映射为 VARCHAR(191)，写入较长操作详情（如批量导入
-- 逐行结果、批量分配的人员/设备清单）时会被 MySQL 截断（严格模式下直接报错），
-- 导致「系统日志内容不全」。
--
-- 扩为 TEXT 后，detail 可存放完整详情，前端也无需再做截断展示。

ALTER TABLE `SystemLog`
    MODIFY `detail` TEXT NOT NULL;