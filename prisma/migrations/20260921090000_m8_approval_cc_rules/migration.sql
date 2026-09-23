-- AlterTable
-- 抄送规则扩展（spec §5.1）：节点支持多规则抄送，非空时按规则并集解析
ALTER TABLE `WorkflowNode` ADD COLUMN `ccRules` JSON NULL;