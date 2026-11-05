-- 资产照片（可选）：存 OSS 对象 key 的 JSON 数组；NULL = 无照片（前端显示类型默认图）
ALTER TABLE `Asset`
    ADD COLUMN `photos` JSON NULL AFTER `notes`;
