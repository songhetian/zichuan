-- AlterTable
ALTER TABLE `Role` ADD COLUMN `departmentScope` VARCHAR(191) NOT NULL DEFAULT 'ALL';

-- CreateTable
CREATE TABLE `RoleDepartment` (
    `roleId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,

    PRIMARY KEY (`roleId`, `departmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RoleDepartment` ADD CONSTRAINT `RoleDepartment_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoleDepartment` ADD CONSTRAINT `RoleDepartment_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
