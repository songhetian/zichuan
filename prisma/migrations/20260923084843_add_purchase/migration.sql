-- AlterTable
ALTER TABLE `approvalrequest` MODIFY `businessType` ENUM('ASSET_UPGRADE', 'ASSET_SCRAP', 'ASSET_RETURN', 'ASSET_REPLACE', 'ASSET_REPAIR', 'ASSET_DEPART', 'ASSET_PURCHASE') NOT NULL;

-- AlterTable
ALTER TABLE `workflowdefinition` MODIFY `businessType` ENUM('ASSET_UPGRADE', 'ASSET_SCRAP', 'ASSET_RETURN', 'ASSET_REPLACE', 'ASSET_REPAIR', 'ASSET_DEPART', 'ASSET_PURCHASE') NOT NULL;

-- CreateTable
CREATE TABLE `PurchaseRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderNo` VARCHAR(191) NOT NULL,
    `requestId` INTEGER NOT NULL,
    `modelId` INTEGER NOT NULL,
    `modelName` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unitPrice` DECIMAL(12, 2) NULL,
    `amount` DECIMAL(14, 2) NULL,
    `initiatorId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PurchaseRecord_orderNo_key`(`orderNo`),
    UNIQUE INDEX `PurchaseRecord_requestId_key`(`requestId`),
    INDEX `PurchaseRecord_createdAt_idx`(`createdAt`),
    INDEX `PurchaseRecord_modelId_idx`(`modelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PurchaseRecord` ADD CONSTRAINT `PurchaseRecord_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRecord` ADD CONSTRAINT `PurchaseRecord_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ComponentModel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRecord` ADD CONSTRAINT `PurchaseRecord_initiatorId_fkey` FOREIGN KEY (`initiatorId`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
