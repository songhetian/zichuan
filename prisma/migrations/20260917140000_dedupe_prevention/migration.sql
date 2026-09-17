-- 去重防护：从数据库层杜绝「同名异伪品牌」配件与「(n) 后缀」设备型号重复
-- 前置：数据已通过 scripts/dedupe-data.mjs 合并，下面约束不会与现有数据冲突。

-- 1) 配件型号：同分类下「型号(规格名)」唯一，忽略品牌（杜绝 08C8/88BC/Kingston/KINGSTON 分身）
ALTER TABLE `ComponentModel`
  DROP INDEX `ComponentModel_categoryId_name_brand_key`,
  ADD UNIQUE KEY `ComponentModel_categoryId_name_key` (`categoryId`, `name`);

-- 2) 设备型号：生成列 normalizedName = 去掉末尾 " (n)" 后缀的规范名，
--    并对 (categoryId, normalizedName) 加唯一约束，使 (2)/(3)... 同规格重复在写入时即被拒绝。
ALTER TABLE `DeviceTemplate`
  ADD COLUMN `normalizedName` VARCHAR(191)
    GENERATED ALWAYS AS (REGEXP_REPLACE(`name`, ' \\([0-9]+\\)$', '')) STORED,
  ADD UNIQUE KEY `DeviceTemplate_categoryId_normalizedName_key` (`categoryId`, `normalizedName`);
