-- AlterTable：「我办理的记录」按配件类型筛选用，从 payload.componentCategoryId 冗余（升级/加购有，其余为空）
ALTER TABLE `ApprovalRequest` ADD COLUMN `componentCategoryId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `ApprovalRequest_componentCategoryId_idx` ON `ApprovalRequest`(`componentCategoryId`);