-- 恢复配件型号的品牌维度
--
-- 背景：20260917140000_dedupe_prevention 曾把 ComponentModel 的唯一约束收敛为
--       (categoryId, name)，即"同分类同名即同型号、品牌不参与去重"。
--       实际业务需要保留品牌维度：同为 8GB 内存，Kingston 与 Samsung 是两个型号。
--
-- 影响面：唯一约束由「更严」放宽为「更松」，现有数据（已按名称合并过）必然满足新约束，
--         不会产生冲突，也不会删除任何数据。

ALTER TABLE `ComponentModel`
  DROP INDEX `ComponentModel_categoryId_name_key`,
  ADD UNIQUE KEY `ComponentModel_categoryId_name_brand_key` (`categoryId`, `name`, `brand`);
