-- 修改 ComponentModel 表：将 brand 字段改为 NOT NULL，默认值为空字符串
-- 并将唯一约束从 (categoryId, name) 改为 (categoryId, name, brand)

-- 1. 先将现有的 NULL 值更新为空字符串
UPDATE `ComponentModel` SET `brand` = '' WHERE `brand` IS NULL;

-- 2. 修改 brand 列为 NOT NULL，默认值为空字符串
ALTER TABLE `ComponentModel` MODIFY COLUMN `brand` VARCHAR(191) NOT NULL DEFAULT '';

-- 3. 添加新的唯一约束 (categoryId, name, brand)
CREATE UNIQUE INDEX `ComponentModel_categoryId_name_brand_key` ON `ComponentModel`(`categoryId`, `name`, `brand`);

-- 4. 删除旧的唯一约束
DROP INDEX `ComponentModel_categoryId_name_key` ON `ComponentModel`;
