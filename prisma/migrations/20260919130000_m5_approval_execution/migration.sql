-- AlterTable
ALTER TABLE `Asset` ADD COLUMN `reservedByRequestId` INTEGER NULL,
    ADD COLUMN `reservedFromStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'IN_STOCK', 'RESERVED') NULL,
    MODIFY `status` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'IN_STOCK', 'RESERVED') NOT NULL DEFAULT 'IDLE';

-- AlterTable
ALTER TABLE `LifecycleLog` ADD COLUMN `operatorId` INTEGER NULL,
    ADD COLUMN `requestId` INTEGER NULL,
    MODIFY `fromStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'IN_STOCK', 'RESERVED') NULL,
    MODIFY `toStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'IN_STOCK', 'RESERVED') NULL;

-- AlterTable
ALTER TABLE `StocktakeRecord` MODIFY `expectedStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'IN_STOCK', 'RESERVED') NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Asset_reservedByRequestId_key` ON `Asset`(`reservedByRequestId`);

-- CreateIndex
CREATE INDEX `LifecycleLog_requestId_idx` ON `LifecycleLog`(`requestId`);

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_reservedByRequestId_fkey` FOREIGN KEY (`reservedByRequestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LifecycleLog` ADD CONSTRAINT `LifecycleLog_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LifecycleLog` ADD CONSTRAINT `LifecycleLog_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
