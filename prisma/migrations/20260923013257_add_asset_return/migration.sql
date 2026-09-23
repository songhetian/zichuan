-- AlterTable
ALTER TABLE `ApprovalRequest` MODIFY `businessType` ENUM('ASSET_UPGRADE', 'ASSET_SCRAP', 'ASSET_RETURN') NOT NULL;

-- AlterTable
ALTER TABLE `WorkflowDefinition` MODIFY `businessType` ENUM('ASSET_UPGRADE', 'ASSET_SCRAP', 'ASSET_RETURN') NOT NULL;
