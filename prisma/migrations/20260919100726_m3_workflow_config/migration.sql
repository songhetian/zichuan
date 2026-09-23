/*
  Warnings:

  - You are about to drop the column `normalizedName` on the `DeviceTemplate` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX `DeviceTemplate_categoryId_normalizedName_key` ON `DeviceTemplate`;

-- AlterTable
ALTER TABLE `DeviceTemplate` DROP COLUMN `normalizedName`;

-- CreateTable
CREATE TABLE `WorkflowDefinition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessType` ENUM('ASSET_UPGRADE') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `publishedAt` DATETIME(3) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WorkflowDefinition_businessType_status_idx`(`businessType`, `status`),
    UNIQUE INDEX `WorkflowDefinition_businessType_version_key`(`businessType`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkflowNode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `definitionId` INTEGER NOT NULL,
    `nodeKey` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('START', 'APPROVAL', 'END') NOT NULL DEFAULT 'APPROVAL',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `assigneeType` ENUM('USER', 'ROLE', 'DEPT_MANAGER', 'EMP_MANAGER', 'INITIATOR', 'CUSTOM') NOT NULL DEFAULT 'EMP_MANAGER',
    `assigneeUserId` INTEGER NULL,
    `assigneeRole` VARCHAR(191) NULL,
    `initiatorCanChoose` BOOLEAN NOT NULL DEFAULT false,
    `multiMode` ENUM('ANY', 'ALL') NOT NULL DEFAULT 'ANY',
    `rejectPolicy` ENUM('TO_PREV', 'TO_START', 'TO_NODE') NOT NULL DEFAULT 'TO_START',
    `rejectToNodeId` INTEGER NULL,
    `ccType` ENUM('NONE', 'INITIATOR', 'DEPT_MANAGER', 'EMP_MANAGER', 'SPECIFIC') NOT NULL DEFAULT 'NONE',
    `ccUserIds` JSON NULL,
    `posX` DOUBLE NOT NULL DEFAULT 0,
    `posY` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WorkflowNode_definitionId_idx`(`definitionId`),
    UNIQUE INDEX `WorkflowNode_definitionId_nodeKey_key`(`definitionId`, `nodeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkflowEdge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `definitionId` INTEGER NOT NULL,
    `fromNodeId` INTEGER NOT NULL,
    `toNodeId` INTEGER NOT NULL,
    `label` VARCHAR(191) NULL,
    `condition` VARCHAR(191) NULL,

    INDEX `WorkflowEdge_definitionId_idx`(`definitionId`),
    INDEX `WorkflowEdge_fromNodeId_idx`(`fromNodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WorkflowDefinition` ADD CONSTRAINT `WorkflowDefinition_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkflowNode` ADD CONSTRAINT `WorkflowNode_definitionId_fkey` FOREIGN KEY (`definitionId`) REFERENCES `WorkflowDefinition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkflowEdge` ADD CONSTRAINT `WorkflowEdge_definitionId_fkey` FOREIGN KEY (`definitionId`) REFERENCES `WorkflowDefinition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkflowEdge` ADD CONSTRAINT `WorkflowEdge_fromNodeId_fkey` FOREIGN KEY (`fromNodeId`) REFERENCES `WorkflowNode`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkflowEdge` ADD CONSTRAINT `WorkflowEdge_toNodeId_fkey` FOREIGN KEY (`toNodeId`) REFERENCES `WorkflowNode`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
