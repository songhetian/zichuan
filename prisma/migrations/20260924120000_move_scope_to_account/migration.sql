-- AlterTable: Admin 增加账号级数据范围
ALTER TABLE `Admin` ADD COLUMN `departmentScope` VARCHAR(191) NOT NULL DEFAULT 'ALL';

-- CreateTable: 账号-部门 关联
CREATE TABLE `AdminDepartment` (
    `adminId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,

    PRIMARY KEY (`adminId`, `departmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AdminDepartment` ADD CONSTRAINT `AdminDepartment_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminDepartment` ADD CONSTRAINT `AdminDepartment_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: 把原「角色级 SPEC 部门范围」继承到所有拥有该角色的账号（幂等，此时 RoleDepartment 仍存在）
-- 旧角色级 SPEC 为「精确限定」（仅关联部门），与账号级新的追加式 'SPEC' 语义不同，
-- 故迁移为 EXACT 模式以严格复现旧范围（仅 departmentLinks，不含主管部门/所属部门）。
UPDATE `Admin` a JOIN `Role` r ON a.`roleId` = r.`id`
SET a.`departmentScope` = 'EXACT'
WHERE r.`departmentScope` = 'SPEC';

INSERT INTO `AdminDepartment` (`adminId`, `departmentId`)
SELECT ad.`id`, rd.`departmentId`
FROM `RoleDepartment` rd
JOIN `Admin` ad ON ad.`roleId` = rd.`roleId`
ON DUPLICATE KEY UPDATE `departmentId` = rd.`departmentId`;

-- Drop: 移除角色级范围字段与关联表
DROP TABLE `RoleDepartment`;
ALTER TABLE `Role` DROP COLUMN `departmentScope`;