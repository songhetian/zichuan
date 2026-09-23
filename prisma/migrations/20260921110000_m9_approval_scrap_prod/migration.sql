-- AlterTable
-- 新增业务类型「申请资产报废」
ALTER TABLE `WorkflowDefinition` MODIFY COLUMN `businessType` ENUM('ASSET_UPGRADE','ASSET_SCRAP') NOT NULL;
ALTER TABLE `ApprovalRequest` MODIFY COLUMN `businessType` ENUM('ASSET_UPGRADE','ASSET_SCRAP') NOT NULL;
