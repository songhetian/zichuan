-- AlterTable
ALTER TABLE `ApprovalRequest` ADD COLUMN `executedAt` DATETIME(3) NULL,
    ADD COLUMN `finalNodeRole` VARCHAR(191) NULL;
