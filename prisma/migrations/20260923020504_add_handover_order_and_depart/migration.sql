-- AlterTable
ALTER TABLE `ApprovalRequest` MODIFY `businessType` ENUM('ASSET_UPGRADE', 'ASSET_SCRAP', 'ASSET_RETURN', 'ASSET_REPLACE', 'ASSET_REPAIR', 'ASSET_DEPART') NOT NULL;

-- AlterTable
ALTER TABLE `WorkflowDefinition` MODIFY `businessType` ENUM('ASSET_UPGRADE', 'ASSET_SCRAP', 'ASSET_RETURN', 'ASSET_REPLACE', 'ASSET_REPAIR', 'ASSET_DEPART') NOT NULL;

-- CreateTable
CREATE TABLE `HandoverOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderNo` VARCHAR(191) NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `requestId` INTEGER NULL,
    `status` ENUM('PENDING', 'COLLECTED') NOT NULL DEFAULT 'PENDING',
    `assetSnapshot` JSON NOT NULL,
    `confirmedById` INTEGER NULL,
    `confirmRemark` VARCHAR(191) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `collectedAt` DATETIME(3) NULL,

    UNIQUE INDEX `HandoverOrder_orderNo_key`(`orderNo`),
    UNIQUE INDEX `HandoverOrder_requestId_key`(`requestId`),
    INDEX `HandoverOrder_employeeId_idx`(`employeeId`),
    INDEX `HandoverOrder_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `HandoverOrder` ADD CONSTRAINT `HandoverOrder_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HandoverOrder` ADD CONSTRAINT `HandoverOrder_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HandoverOrder` ADD CONSTRAINT `HandoverOrder_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
