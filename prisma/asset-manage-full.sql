/* ============================================================
 * asset-manage-full.sql —— 全量自包含数据库文件
 * ------------------------------------------------------------
 * 来源：早期版本 MySQL 逻辑导出(资产平台) + 当前 Prisma schema + 种子结构
 * 用途：一次性灌入全新库即可得到「当前 schema + 完整旧业务数据 + 全部登录账号」
 *
 * 组成（按顺序）：
 *   1) DDL —— 当前全部表结构(CREATE TABLE + 外键)，由 prisma migrate diff 生成
 *   2) 种子结构 —— 角色/权限/角色-权限矩阵/默认审批流程(Role/Permission/RolePermission/Workflow*)
 *   3) 旧业务数据 —— Department/Employee/AssetCategory/ComponentCategory/DeviceTemplate/
 *                    TemplateComponent/Asset/AssetComponent/LifecycleLog/Stocktake/SystemLog
 *   4) 登录账号 —— 旧 admin(超级管理员) + 为每个旧员工自动建号(登录名=工号，默认密码123456，
 *                  mustChangePassword=true，普通员工角色 EMPLOYEE)
 *   5) AUTO_INCREMENT 修正 —— 使各表自增从现有 max(id)+1 继续，避免后续插入主键冲突
 *
 * 账号说明：
 *   - admin：保留旧 bcrypt 密码哈希(老密码可继续登录)，SUPER_ADMIN，isActive，departmentScope=ALL
 *   - 员工账号：username=工号 / EMPLOYEE / mustChangePassword=true / 默认密码 123456
 *   - 部门数据保持旧值(managerId 为空)；如需部门主管角色可在后续按需指派
 *
 * 导入方式：
 *   a) mysql -u<user> -p < targetdb < asset-manage-full.sql
 * ============================================================ */

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

/* ------------------------------------------------------------------ */
/* 1) DDL —— 当前 schema 全量表结构                                      */
/* ------------------------------------------------------------------ */
-- [DDL-START]

-- CreateTable
CREATE TABLE `ComponentCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `parentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ComponentCategory_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComponentModel` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(191) NOT NULL DEFAULT '',
    `categoryId` INTEGER NOT NULL,

    UNIQUE INDEX `ComponentModel_categoryId_name_brand_key`(`categoryId`, `name`, `brand`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComponentStock` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `modelId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ComponentStock_modelId_key`(`modelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ComponentStockLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `modelId` INTEGER NOT NULL,
    `type` ENUM('PURCHASE_IN', 'UPGRADE_RETURN', 'ASSET_BUILD', 'UPGRADE_USE') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `operator` VARCHAR(191) NOT NULL,
    `remark` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ComponentStockLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `is_unique` BOOLEAN NOT NULL DEFAULT false,
    `numberingRule` VARCHAR(191) NULL,
    `parentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AssetCategory_name_key`(`name`),
    UNIQUE INDEX `AssetCategory_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeviceTemplate_categoryId_name_key`(`categoryId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TemplateComponent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `templateId` INTEGER NOT NULL,
    `modelId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `TemplateComponent_templateId_modelId_key`(`templateId`, `modelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Department` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `managerId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Department_name_key`(`name`),
    INDEX `Department_managerId_idx`(`managerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Employee` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeNo` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `departmentId` INTEGER NOT NULL,
    `status` ENUM('ACTIVE', 'LEFT') NOT NULL DEFAULT 'ACTIVE',
    `managerId` INTEGER NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Employee_employeeNo_key`(`employeeNo`),
    INDEX `Employee_managerId_idx`(`managerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Asset` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetNo` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `templateId` INTEGER NOT NULL,
    `status` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'IN_STOCK', 'RESERVED') NOT NULL DEFAULT 'IDLE',
    `employeeId` INTEGER NULL,
    `location` VARCHAR(191) NULL,
    `purchaseDate` DATETIME(3) NULL,
    `warrantyMonths` INTEGER NULL,
    `notes` VARCHAR(191) NULL,
    `reservedByRequestId` INTEGER NULL,
    `reservedFromStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'IN_STOCK', 'RESERVED') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Asset_assetNo_key`(`assetNo`),
    UNIQUE INDEX `Asset_reservedByRequestId_key`(`reservedByRequestId`),
    INDEX `Asset_employeeId_idx`(`employeeId`),
    INDEX `Asset_templateId_idx`(`templateId`),
    INDEX `Asset_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AssetComponent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `modelId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `AssetComponent_assetId_modelId_key`(`assetId`, `modelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LifecycleLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `action` ENUM('CREATED', 'ALLOCATED', 'RETURNED', 'TRANSFERRED', 'UPGRADED', 'MAINTENANCE_START', 'MAINTENANCE_DONE', 'SCRAPPED', 'REPLACED') NOT NULL,
    `fromStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'IN_STOCK', 'RESERVED') NULL,
    `toStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'IN_STOCK', 'RESERVED') NULL,
    `employeeId` INTEGER NULL,
    `fromEmployeeId` INTEGER NULL,
    `operator` VARCHAR(191) NOT NULL,
    `operatorId` INTEGER NULL,
    `requestId` INTEGER NULL,
    `remark` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LifecycleLog_assetId_idx`(`assetId`),
    INDEX `LifecycleLog_createdAt_idx`(`createdAt`),
    INDEX `LifecycleLog_action_idx`(`action`),
    INDEX `LifecycleLog_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Admin` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NULL,
    `roleId` INTEGER NULL,
    `employeeId` INTEGER NULL,
    `departmentScope` VARCHAR(191) NOT NULL DEFAULT 'ALL',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Admin_username_key`(`username`),
    UNIQUE INDEX `Admin_employeeId_key`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isSystem` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Role_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `module` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Permission_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `roleId` INTEGER NOT NULL,
    `permissionId` INTEGER NOT NULL,

    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminDepartment` (
    `adminId` INTEGER NOT NULL,
    `departmentId` INTEGER NOT NULL,

    PRIMARY KEY (`adminId`, `departmentId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SystemLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `module` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `detail` VARCHAR(191) NOT NULL,
    `operator` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SystemLog_createdAt_idx`(`createdAt`),
    INDEX `SystemLog_module_idx`(`module`),
    INDEX `SystemLog_operator_idx`(`operator`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StocktakeSession` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` ENUM('OPEN', 'COMPLETED') NOT NULL DEFAULT 'OPEN',
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StocktakeRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sessionId` INTEGER NOT NULL,
    `assetId` INTEGER NOT NULL,
    `expectedStatus` ENUM('IDLE', 'IN_USE', 'IN_MAINTENANCE', 'SCRAPPED', 'IN_STOCK', 'RESERVED') NOT NULL,
    `actualStatus` ENUM('NORMAL', 'MISSING', 'EXTRA') NOT NULL,
    `remark` VARCHAR(191) NULL,

    UNIQUE INDEX `StocktakeRecord_sessionId_assetId_key`(`sessionId`, `assetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkflowDefinition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessType` ENUM('ASSET_UPGRADE', 'ASSET_SCRAP', 'ASSET_RETURN', 'ASSET_REPLACE', 'ASSET_REPAIR', 'ASSET_DEPART', 'ASSET_PURCHASE') NOT NULL,
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
    `ccRules` JSON NULL,
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

-- CreateTable
CREATE TABLE `ApprovalRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestNo` VARCHAR(191) NOT NULL,
    `definitionId` INTEGER NOT NULL,
    `businessType` ENUM('ASSET_UPGRADE', 'ASSET_SCRAP', 'ASSET_RETURN', 'ASSET_REPLACE', 'ASSET_REPAIR', 'ASSET_DEPART', 'ASSET_PURCHASE') NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `currentNodeId` INTEGER NULL,
    `initiatorId` INTEGER NOT NULL,
    `targetEmployeeId` INTEGER NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `executedAt` DATETIME(3) NULL,
    `finalNodeRole` VARCHAR(191) NULL,

    UNIQUE INDEX `ApprovalRequest_requestNo_key`(`requestNo`),
    INDEX `ApprovalRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ApprovalRequest_initiatorId_status_idx`(`initiatorId`, `status`),
    INDEX `ApprovalRequest_businessType_status_idx`(`businessType`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

-- CreateTable
CREATE TABLE `ApprovalTask` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` INTEGER NOT NULL,
    `nodeId` INTEGER NOT NULL,
    `nodeKey` VARCHAR(191) NOT NULL,
    `assigneeId` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `comment` VARCHAR(191) NULL,
    `actedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ApprovalTask_assigneeId_status_createdAt_idx`(`assigneeId`, `status`, `createdAt`),
    INDEX `ApprovalTask_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `adminId` INTEGER NOT NULL,
    `requestId` INTEGER NULL,
    `type` ENUM('APPROVAL_TODO', 'APPROVAL_RESULT', 'APPROVAL_CC', 'SYSTEM') NOT NULL DEFAULT 'SYSTEM',
    `title` VARCHAR(191) NOT NULL,
    `content` VARCHAR(191) NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_adminId_isRead_createdAt_idx`(`adminId`, `isRead`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ApprovalLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` INTEGER NOT NULL,
    `actorId` INTEGER NULL,
    `action` ENUM('SUBMIT', 'APPROVE', 'REJECT', 'CANCEL', 'EXECUTE', 'EXECUTE_FAILED') NOT NULL,
    `fromNodeKey` VARCHAR(191) NULL,
    `toNodeKey` VARCHAR(191) NULL,
    `comment` VARCHAR(191) NULL,
    `meta` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ApprovalLog_requestId_createdAt_idx`(`requestId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ComponentCategory` ADD CONSTRAINT `ComponentCategory_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `ComponentCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComponentModel` ADD CONSTRAINT `ComponentModel_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ComponentCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComponentStock` ADD CONSTRAINT `ComponentStock_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ComponentModel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComponentStockLog` ADD CONSTRAINT `ComponentStockLog_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ComponentModel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetCategory` ADD CONSTRAINT `AssetCategory_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `AssetCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceTemplate` ADD CONSTRAINT `DeviceTemplate_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `AssetCategory`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TemplateComponent` ADD CONSTRAINT `TemplateComponent_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `DeviceTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TemplateComponent` ADD CONSTRAINT `TemplateComponent_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ComponentModel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Department` ADD CONSTRAINT `Department_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `DeviceTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Asset` ADD CONSTRAINT `Asset_reservedByRequestId_fkey` FOREIGN KEY (`reservedByRequestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetComponent` ADD CONSTRAINT `AssetComponent_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AssetComponent` ADD CONSTRAINT `AssetComponent_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ComponentModel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LifecycleLog` ADD CONSTRAINT `LifecycleLog_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LifecycleLog` ADD CONSTRAINT `LifecycleLog_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LifecycleLog` ADD CONSTRAINT `LifecycleLog_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Admin` ADD CONSTRAINT `Admin_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Admin` ADD CONSTRAINT `Admin_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminDepartment` ADD CONSTRAINT `AdminDepartment_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminDepartment` ADD CONSTRAINT `AdminDepartment_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `Department`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StocktakeRecord` ADD CONSTRAINT `StocktakeRecord_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `StocktakeSession`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StocktakeRecord` ADD CONSTRAINT `StocktakeRecord_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `Asset`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE `PurchaseRecord` ADD CONSTRAINT `PurchaseRecord_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRecord` ADD CONSTRAINT `PurchaseRecord_modelId_fkey` FOREIGN KEY (`modelId`) REFERENCES `ComponentModel`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseRecord` ADD CONSTRAINT `PurchaseRecord_initiatorId_fkey` FOREIGN KEY (`initiatorId`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalRequest` ADD CONSTRAINT `ApprovalRequest_definitionId_fkey` FOREIGN KEY (`definitionId`) REFERENCES `WorkflowDefinition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalRequest` ADD CONSTRAINT `ApprovalRequest_currentNodeId_fkey` FOREIGN KEY (`currentNodeId`) REFERENCES `WorkflowNode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalRequest` ADD CONSTRAINT `ApprovalRequest_initiatorId_fkey` FOREIGN KEY (`initiatorId`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HandoverOrder` ADD CONSTRAINT `HandoverOrder_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HandoverOrder` ADD CONSTRAINT `HandoverOrder_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HandoverOrder` ADD CONSTRAINT `HandoverOrder_confirmedById_fkey` FOREIGN KEY (`confirmedById`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalTask` ADD CONSTRAINT `ApprovalTask_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalTask` ADD CONSTRAINT `ApprovalTask_nodeId_fkey` FOREIGN KEY (`nodeId`) REFERENCES `WorkflowNode`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalTask` ADD CONSTRAINT `ApprovalTask_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `Admin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalLog` ADD CONSTRAINT `ApprovalLog_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalLog` ADD CONSTRAINT `ApprovalLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- [DDL-END]
/* ------------------------------------------------------------------ */
/* 2) 种子结构与流程（来自已 seed 的 dev 库）                            */
/* ------------------------------------------------------------------ */

-- 角色 Role
INSERT INTO `Role` (`id`,`key`,`name`,`isSystem`,`createdAt`,`updatedAt`) VALUES (1,'SUPER_ADMIN','超级管理员',1,'2026-09-24 12:10:59.524','2026-09-24 12:10:59.524');
INSERT INTO `Role` (`id`,`key`,`name`,`isSystem`,`createdAt`,`updatedAt`) VALUES (2,'ASSET_MANAGER','资产管理员',1,'2026-09-24 12:10:59.599','2026-09-24 12:10:59.599');
INSERT INTO `Role` (`id`,`key`,`name`,`isSystem`,`createdAt`,`updatedAt`) VALUES (3,'DEPT_MANAGER','部门主管',1,'2026-09-24 12:10:59.666','2026-09-24 12:10:59.666');
INSERT INTO `Role` (`id`,`key`,`name`,`isSystem`,`createdAt`,`updatedAt`) VALUES (4,'EMPLOYEE','普通员工',1,'2026-09-24 12:10:59.683','2026-09-24 12:10:59.683');

-- 权限 Permission
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (1,'asset.manage','资产与库存','资产与库存管理');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (2,'asset.device.view','资产与库存','设备列表');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (3,'asset.device.create','资产与库存','新增设备');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (4,'asset.device.update','资产与库存','编辑设备');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (5,'asset.device.delete','资产与库存','删除设备');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (6,'asset.device.export','资产与库存','导出设备');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (7,'asset.template.view','资产与库存','设备模板');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (8,'asset.template.create','资产与库存','新建模板');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (9,'asset.template.update','资产与库存','编辑模板');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (10,'asset.template.delete','资产与库存','删除模板');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (11,'asset.import.view','资产与库存','批量入库');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (12,'asset.import.execute','资产与库存','执行导入');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (13,'asset.component.view','资产与库存','配件库存');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (14,'asset.component.create','资产与库存','新增配件');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (15,'asset.component.update','资产与库存','编辑配件');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (16,'asset.component.delete','资产与库存','删除配件');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (17,'asset.stockflow.view','资产与库存','库存流水');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (18,'asset.purchase.view','资产与库存','加购配件 / 采购留痕');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (19,'asset.purchase.submit','资产与库存','发起加购');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (20,'asset.purchase.export','资产与库存','导出留痕');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (21,'asset.stocktake.view','资产与库存','库存盘点');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (22,'asset.stocktake.start','资产与库存','发起盘点');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (23,'asset.stocktake.commit','资产与库存','确认盘点');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (24,'asset.upgrade.view','资产与库存','待执行变更');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (25,'asset.upgrade.execute','资产与库存','执行变更');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (26,'asset.replace.execute','资产与库存','执行更换');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (27,'asset.repair.execute','资产与库存','执行维修');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (28,'asset.category.view','资产与库存','设备分类');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (29,'asset.category.create','资产与库存','新增分类');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (30,'asset.category.update','资产与库存','编辑分类');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (31,'asset.category.delete','资产与库存','删除分类');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (32,'asset.compcategory.view','资产与库存','配件分类');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (33,'asset.compcategory.create','资产与库存','新增分类');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (34,'asset.compcategory.update','资产与库存','编辑分类');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (35,'asset.compcategory.delete','资产与库存','删除分类');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (36,'asset.label.view','资产与库存','标签打印');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (37,'asset.label.print','资产与库存','打印标签');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (38,'approval.submit','审批-提交','提交审批申请');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (39,'approval.new.view','审批-提交','发起申请');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (40,'approval.my.view','审批-提交','我的申请');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (41,'approval.approve','审批-处理','审批操作');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (42,'approval.todo.view','审批-处理','我的待办');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (43,'approval.todo.approve','审批-处理','审批通过');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (44,'approval.todo.reject','审批-处理','驳回');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (45,'approval.detail.view','审批-处理','申请单详情');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (46,'system.account.manage','员工与账号','账号与权限管理');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (47,'employee.view','员工与账号','员工管理');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (48,'employee.create','员工与账号','新增员工');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (49,'employee.update','员工与账号','编辑员工');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (50,'employee.delete','员工与账号','删除员工');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (51,'employee.import','员工与账号','导入员工');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (52,'user.view','员工与账号','用户管理');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (53,'user.create','员工与账号','新增用户');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (54,'user.update','员工与账号','编辑用户');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (55,'user.delete','员工与账号','删除用户');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (56,'user.resetpwd','员工与账号','重置密码');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (57,'role.view','员工与账号','角色权限');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (58,'department.view','员工与账号','部门管理');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (59,'department.create','员工与账号','新增部门');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (60,'department.update','员工与账号','编辑部门');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (61,'department.delete','员工与账号','删除部门');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (62,'workflow.config.manage','审批流程','审批流程配置');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (63,'workflow.view','审批流程','流程配置');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (64,'workflow.create','审批流程','新建模板');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (65,'workflow.update','审批流程','编辑模板');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (66,'workflow.delete','审批流程','删除模板');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (67,'workflow.version','审批流程','版本切换');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (68,'dept.data.view','数据范围','本部门数据可见');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (69,'asset.depart.view','离职交接','离职交接管理');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (70,'asset.depart.handover.view','离职交接','交接对账');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (71,'asset.depart.execute','离职交接','对账确认回收');
INSERT INTO `Permission` (`id`,`key`,`module`,`name`) VALUES (72,'asset.view.own','数据范围','查看本人资产与申请单');

-- 角色-权限 RolePermission
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,1);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,2);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,3);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,4);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,5);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,6);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,7);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,8);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,9);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,10);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,11);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,12);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,13);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,14);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,15);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,16);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,17);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,18);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,19);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,20);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,21);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,22);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,23);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,24);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,25);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,26);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,27);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,28);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,29);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,30);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,31);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,32);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,33);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,34);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,35);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,36);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,37);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,38);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,39);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,40);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,41);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,42);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,43);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,44);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,45);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,46);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,47);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,48);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,49);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,50);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,51);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,52);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,53);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,54);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,55);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,56);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,57);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,58);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,59);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,60);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,61);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,62);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,63);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,64);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,65);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,66);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,67);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,68);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,69);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,70);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,71);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (1,72);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (2,1);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (2,18);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (2,38);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (2,41);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (2,68);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (2,69);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (2,72);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (3,2);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (3,38);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (3,41);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (3,68);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (3,72);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (4,2);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (4,38);
INSERT INTO `RolePermission` (`roleId`,`permissionId`) VALUES (4,72);

-- 流程定义 WorkflowDefinition
INSERT INTO `WorkflowDefinition` (`id`,`businessType`,`name`,`version`,`status`,`publishedAt`,`createdById`,`createdAt`,`updatedAt`) VALUES (1,'ASSET_UPGRADE','申请升级配件流程',1,'PUBLISHED','2026-09-24 12:10:59.819',NULL,'2026-09-24 12:10:59.822','2026-09-24 12:10:59.822');
INSERT INTO `WorkflowDefinition` (`id`,`businessType`,`name`,`version`,`status`,`publishedAt`,`createdById`,`createdAt`,`updatedAt`) VALUES (2,'ASSET_SCRAP','申请资产报废流程',1,'PUBLISHED','2026-09-24 12:10:59.845',NULL,'2026-09-24 12:10:59.846','2026-09-24 12:10:59.846');
INSERT INTO `WorkflowDefinition` (`id`,`businessType`,`name`,`version`,`status`,`publishedAt`,`createdById`,`createdAt`,`updatedAt`) VALUES (3,'ASSET_PURCHASE','申请加购配件流程',1,'PUBLISHED','2026-09-24 12:10:59.862',NULL,'2026-09-24 12:10:59.862','2026-09-24 12:10:59.862');
INSERT INTO `WorkflowDefinition` (`id`,`businessType`,`name`,`version`,`status`,`publishedAt`,`createdById`,`createdAt`,`updatedAt`) VALUES (4,'ASSET_RETURN','申请设备退回流程',1,'PUBLISHED','2026-09-24 12:10:59.870',NULL,'2026-09-24 12:10:59.871','2026-09-24 12:10:59.871');
INSERT INTO `WorkflowDefinition` (`id`,`businessType`,`name`,`version`,`status`,`publishedAt`,`createdById`,`createdAt`,`updatedAt`) VALUES (5,'ASSET_REPLACE','申请更换设备流程',1,'PUBLISHED','2026-09-24 12:10:59.894',NULL,'2026-09-24 12:10:59.895','2026-09-24 12:10:59.895');
INSERT INTO `WorkflowDefinition` (`id`,`businessType`,`name`,`version`,`status`,`publishedAt`,`createdById`,`createdAt`,`updatedAt`) VALUES (6,'ASSET_REPAIR','申请设备维修流程',1,'PUBLISHED','2026-09-24 12:10:59.903',NULL,'2026-09-24 12:10:59.904','2026-09-24 12:10:59.904');
INSERT INTO `WorkflowDefinition` (`id`,`businessType`,`name`,`version`,`status`,`publishedAt`,`createdById`,`createdAt`,`updatedAt`) VALUES (7,'ASSET_DEPART','申请员工离职流程',1,'PUBLISHED','2026-09-24 12:10:59.914',NULL,'2026-09-24 12:10:59.915','2026-09-24 12:10:59.915');

-- 流程节点 WorkflowNode
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (1,1,'n1','部门主管审批','APPROVAL',0,'DEPT_MANAGER',NULL,NULL,0,'ANY','TO_START',NULL,'NONE',NULL,'[{"type":"INITIATOR"},{"type":"ROLE","roleKey":"ASSET_MANAGER"}]',0,0,'2026-09-24 12:10:59.822','2026-09-24 12:10:59.822');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (2,1,'n2','资产管理员审批','APPROVAL',1,'ROLE',NULL,'ASSET_MANAGER',0,'ANY','TO_START',NULL,'INITIATOR',NULL,NULL,0,0,'2026-09-24 12:10:59.822','2026-09-24 12:10:59.822');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (3,2,'n1','部门主管审批','APPROVAL',0,'DEPT_MANAGER',NULL,NULL,0,'ANY','TO_START',NULL,'NONE',NULL,'[{"type":"INITIATOR"},{"type":"ROLE","roleKey":"ASSET_MANAGER"}]',0,0,'2026-09-24 12:10:59.846','2026-09-24 12:10:59.846');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (4,2,'n2','资产管理员审批','APPROVAL',1,'ROLE',NULL,'ASSET_MANAGER',0,'ANY','TO_START',NULL,'INITIATOR',NULL,NULL,0,0,'2026-09-24 12:10:59.846','2026-09-24 12:10:59.846');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (5,3,'n1','部门主管审批','APPROVAL',0,'DEPT_MANAGER',NULL,NULL,0,'ANY','TO_START',NULL,'NONE',NULL,'[{"type":"INITIATOR"},{"type":"ROLE","roleKey":"ASSET_MANAGER"}]',0,0,'2026-09-24 12:10:59.862','2026-09-24 12:10:59.862');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (6,3,'n2','资产管理员审批','APPROVAL',1,'ROLE',NULL,'ASSET_MANAGER',0,'ANY','TO_START',NULL,'INITIATOR',NULL,NULL,0,0,'2026-09-24 12:10:59.862','2026-09-24 12:10:59.862');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (7,4,'n1','部门主管审批','APPROVAL',0,'DEPT_MANAGER',NULL,NULL,0,'ANY','TO_START',NULL,'NONE',NULL,'[{"type":"INITIATOR"},{"type":"ROLE","roleKey":"ASSET_MANAGER"}]',0,0,'2026-09-24 12:10:59.871','2026-09-24 12:10:59.871');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (8,4,'n2','资产管理员审批','APPROVAL',1,'ROLE',NULL,'ASSET_MANAGER',0,'ANY','TO_START',NULL,'INITIATOR',NULL,NULL,0,0,'2026-09-24 12:10:59.871','2026-09-24 12:10:59.871');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (9,5,'n1','部门主管审批','APPROVAL',0,'DEPT_MANAGER',NULL,NULL,0,'ANY','TO_START',NULL,'NONE',NULL,'[{"type":"INITIATOR"},{"type":"ROLE","roleKey":"ASSET_MANAGER"}]',0,0,'2026-09-24 12:10:59.895','2026-09-24 12:10:59.895');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (10,5,'n2','资产管理员审批','APPROVAL',1,'ROLE',NULL,'ASSET_MANAGER',0,'ANY','TO_START',NULL,'INITIATOR',NULL,NULL,0,0,'2026-09-24 12:10:59.895','2026-09-24 12:10:59.895');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (11,6,'n1','部门主管审批','APPROVAL',0,'DEPT_MANAGER',NULL,NULL,0,'ANY','TO_START',NULL,'NONE',NULL,'[{"type":"INITIATOR"},{"type":"ROLE","roleKey":"ASSET_MANAGER"}]',0,0,'2026-09-24 12:10:59.904','2026-09-24 12:10:59.904');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (12,6,'n2','资产管理员审批','APPROVAL',1,'ROLE',NULL,'ASSET_MANAGER',0,'ANY','TO_START',NULL,'INITIATOR',NULL,NULL,0,0,'2026-09-24 12:10:59.904','2026-09-24 12:10:59.904');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (13,7,'n1','部门主管审批','APPROVAL',0,'DEPT_MANAGER',NULL,NULL,0,'ANY','TO_START',NULL,'NONE',NULL,'[{"type":"INITIATOR"},{"type":"ROLE","roleKey":"ASSET_MANAGER"}]',0,0,'2026-09-24 12:10:59.915','2026-09-24 12:10:59.915');
INSERT INTO `WorkflowNode` (`id`,`definitionId`,`nodeKey`,`name`,`type`,`sortOrder`,`assigneeType`,`assigneeUserId`,`assigneeRole`,`initiatorCanChoose`,`multiMode`,`rejectPolicy`,`rejectToNodeId`,`ccType`,`ccUserIds`,`ccRules`,`posX`,`posY`,`createdAt`,`updatedAt`) VALUES (14,7,'n2','资产管理员审批','APPROVAL',1,'ROLE',NULL,'ASSET_MANAGER',0,'ANY','TO_START',NULL,'INITIATOR',NULL,NULL,0,0,'2026-09-24 12:10:59.915','2026-09-24 12:10:59.915');


/* ------------------------------------------------------------------ */
/* 3) 旧业务数据（转换到当前 schema）                                    */
/*    顺序遵循外键依赖：先被引用表，后引用表；主键 id 保留旧值保证 FK 成立   */
/* ------------------------------------------------------------------ */

-- 部门 Department
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (1,'都芳健灵','2026-08-05 08:35:19.348','2026-08-05 08:35:19.348');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (2,'斐乐','2026-08-05 08:35:24.175','2026-08-05 08:35:24.175');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (3,'林内POP','2026-08-05 08:35:36.102','2026-08-05 08:35:36.102');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (4,'麦乐多','2026-08-05 08:35:43.704','2026-08-05 08:35:43.704');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (5,'麦乐多小店','2026-08-05 08:36:18.840','2026-08-05 08:36:18.840');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (6,'雀巢','2026-08-05 08:36:23.732','2026-08-05 08:36:23.732');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (7,'小左组','2026-08-05 08:36:29.322','2026-08-05 08:36:29.322');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (8,'欣拓','2026-08-05 08:36:34.769','2026-08-05 08:36:34.769');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (9,'尚雨','2026-08-06 02:12:41.574','2026-08-06 02:12:41.574');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (10,'童年时光','2026-08-06 02:12:55.533','2026-08-06 02:12:55.533');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (11,'惠氏','2026-08-06 02:12:55.600','2026-08-06 02:12:55.600');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (12,'天使梳','2026-08-06 02:12:55.735','2026-08-06 02:12:55.735');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (13,'运营部','2026-08-06 02:13:00.280','2026-08-06 02:13:00.280');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (14,'林内自营','2026-08-06 05:44:21.235','2026-08-06 05:44:21.235');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (15,'唐琳','2026-08-06 08:51:55.258','2026-08-06 08:51:55.258');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (16,'林内-五星','2026-08-06 10:13:45.381','2026-08-06 10:13:45.381');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (17,'麦乐多大店','2026-08-07 01:38:48.867','2026-08-07 01:38:48.867');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (18,'财务部','2026-08-11 03:52:21.510','2026-08-11 03:52:21.510');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (19,'空闲','2026-08-11 06:10:50.022','2026-08-11 06:10:50.022');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (20,'会议室','2026-08-12 02:14:19.637','2026-08-12 02:14:19.637');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (21,'外交官','2026-08-13 06:18:41.744','2026-08-13 06:18:41.744');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (22,'测试','2026-09-10 07:23:45.074','2026-09-10 07:23:45.074');
INSERT INTO `Department` (`id`,`name`,`createdAt`,`updatedAt`) VALUES (23,'双立人','2026-09-15 01:41:59.069','2026-09-15 01:41:59.069');

-- 员工 Employee
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (1,'EMP0001','刘源',1,NULL,NULL,'2026-08-05 08:35:19.352','2026-08-05 08:35:19.352');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (2,'EMP0002','张艳茹',1,NULL,NULL,'2026-08-05 08:35:19.432','2026-08-05 08:35:19.432');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (3,'EMP0003','李佳',1,NULL,NULL,'2026-08-05 08:35:19.525','2026-08-05 08:35:19.525');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (4,'EMP0004','李美双',1,NULL,NULL,'2026-08-05 08:35:19.646','2026-08-05 08:35:19.646');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (5,'EMP0005','赵闯',2,NULL,NULL,'2026-08-05 08:35:24.178','2026-08-05 08:35:24.178');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (6,'EMP0006','秦梓涵',2,NULL,NULL,'2026-08-05 08:35:24.271','2026-08-05 08:35:24.271');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (7,'EMP0007','李一娜',2,NULL,NULL,'2026-08-05 08:35:24.367','2026-08-05 08:35:24.367');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (8,'EMP0008','周丽',2,NULL,NULL,'2026-08-05 08:35:24.505','2026-08-05 08:35:24.505');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (9,'EMP0009','宋恬',2,NULL,NULL,'2026-08-05 08:35:24.648','2026-08-05 08:35:24.648');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (10,'EMP0010','张良爽',2,NULL,NULL,'2026-08-05 08:35:24.700','2026-08-05 08:35:24.700');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (11,'EMP0011','袁雯珊',2,NULL,NULL,'2026-08-05 08:35:24.753','2026-08-05 08:35:24.753');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (12,'EMP0012','魏栩莹',2,NULL,NULL,'2026-08-05 08:35:24.884','2026-08-05 08:35:24.884');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (13,'EMP0013','韩晓林',2,NULL,NULL,'2026-08-05 08:35:25.089','2026-08-05 08:35:25.089');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (14,'EMP0014','王璐瑀',2,NULL,NULL,'2026-08-05 08:35:25.211','2026-08-05 08:35:25.211');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (15,'EMP0015','陈凯月',2,NULL,NULL,'2026-08-05 08:35:25.308','2026-08-05 08:35:25.308');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (16,'EMP0016','王畅',2,NULL,NULL,'2026-08-05 08:35:25.404','2026-08-05 08:35:25.404');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (17,'EMP0017','王艳华',2,NULL,NULL,'2026-08-05 08:35:25.512','2026-08-05 08:35:25.512');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (18,'EMP0018','乔雪坤',2,NULL,NULL,'2026-08-05 08:35:25.624','2026-08-05 08:35:25.624');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (19,'EMP0019','黑德凯',2,NULL,NULL,'2026-08-05 08:35:25.719','2026-08-05 08:35:25.719');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (20,'EMP0020','徐佳红',2,NULL,NULL,'2026-08-05 08:35:25.866','2026-08-05 08:35:25.866');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (21,'EMP0021','王星戈',2,NULL,NULL,'2026-08-05 08:35:26.033','2026-08-05 08:35:26.033');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (22,'EMP0022','宫庆芳',2,NULL,NULL,'2026-08-05 08:35:26.135','2026-08-05 08:35:26.135');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (23,'EMP0023','代城昊',2,NULL,NULL,'2026-08-05 08:35:26.201','2026-08-05 08:35:26.201');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (24,'EMP0024','高海兰',2,NULL,NULL,'2026-08-05 08:35:26.263','2026-08-05 08:35:26.263');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (25,'EMP0025','祖国庆',3,NULL,NULL,'2026-08-05 08:35:36.104','2026-08-05 08:35:36.104');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (26,'EMP0026','刘美宁',3,NULL,NULL,'2026-08-05 08:35:36.204','2026-08-05 08:35:36.204');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (27,'EMP0027','王镜淇',3,NULL,NULL,'2026-08-05 08:35:36.340','2026-08-05 08:35:36.340');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (28,'EMP0028','刘航',3,NULL,NULL,'2026-08-05 08:35:36.458','2026-08-05 08:35:36.458');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (29,'EMP0029','任雅瑞',3,NULL,NULL,'2026-08-05 08:35:36.555','2026-08-05 08:35:36.555');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (30,'EMP0030','赵鹏瑾',3,NULL,NULL,'2026-08-05 08:35:36.598','2026-08-05 08:35:36.598');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (31,'EMP0031','韩熹晨',3,NULL,NULL,'2026-08-05 08:35:36.658','2026-08-05 08:35:36.658');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (32,'EMP0032','李怡庆',4,NULL,NULL,'2026-08-05 08:35:43.707','2026-08-05 08:35:43.707');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (33,'EMP0033','杨柳',23,NULL,NULL,'2026-08-05 08:35:43.868','2026-09-15 02:21:57.340');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (34,'EMP0034','梁子丹',4,NULL,NULL,'2026-08-05 08:35:44.114','2026-08-05 08:35:44.114');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (35,'EMP0035','张依',4,NULL,NULL,'2026-08-05 08:35:44.250','2026-08-05 08:35:44.250');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (36,'EMP0036','倪紫韵',4,NULL,NULL,'2026-08-05 08:35:44.377','2026-08-05 08:35:44.377');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (37,'EMP0037','郑永蔷',4,NULL,NULL,'2026-08-05 08:35:44.523','2026-08-05 08:35:44.523');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (38,'EMP0038','郭启峰',4,NULL,NULL,'2026-08-05 08:35:44.636','2026-09-11 04:22:03.494');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (39,'EMP0039','袁永超',4,NULL,NULL,'2026-08-05 08:35:44.762','2026-08-05 08:35:44.762');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (40,'EMP0040','徐欢',4,NULL,NULL,'2026-08-05 08:35:44.905','2026-08-05 08:35:44.905');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (41,'EMP0041','张燕',5,NULL,NULL,'2026-08-05 08:36:18.843','2026-08-05 08:36:18.843');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (42,'EMP0042','备用机',5,NULL,NULL,'2026-08-05 08:36:18.926','2026-08-05 08:36:18.926');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (43,'EMP0043','龙腾云',5,NULL,NULL,'2026-08-05 08:36:19.051','2026-08-05 08:36:19.051');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (44,'EMP0044','唐月',5,NULL,NULL,'2026-08-05 08:36:19.138','2026-08-05 08:36:19.138');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (45,'EMP0045','牛尚尚',5,NULL,NULL,'2026-08-05 08:36:19.224','2026-08-05 08:36:19.224');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (46,'EMP0046','叼婷婷',5,NULL,NULL,'2026-08-05 08:36:19.311','2026-08-05 08:36:19.311');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (47,'EMP0047','齐玉婷',5,NULL,NULL,'2026-08-05 08:36:19.402','2026-08-05 08:36:19.402');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (48,'EMP0048','徐金洋',6,NULL,NULL,'2026-08-05 08:36:23.735','2026-08-05 08:36:23.735');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (49,'EMP0049','刘勃瑶',6,NULL,NULL,'2026-08-05 08:36:23.884','2026-09-21 05:19:58.043');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (50,'EMP0050','靳阔',6,NULL,NULL,'2026-08-05 08:36:24.048','2026-08-05 08:36:24.048');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (51,'EMP0051','陈荣荣',6,NULL,NULL,'2026-08-05 08:36:24.165','2026-08-05 08:36:24.165');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (52,'EMP0052','杨美茹',6,NULL,NULL,'2026-08-05 08:36:24.247','2026-08-05 08:36:24.247');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (53,'EMP0053','卞雲吉',6,NULL,NULL,'2026-08-05 08:36:24.399','2026-08-05 08:36:24.399');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (54,'EMP0054','孟子暄',6,NULL,NULL,'2026-08-05 08:36:24.523','2026-08-05 08:36:24.523');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (55,'EMP0055','左丽杰',7,NULL,NULL,'2026-08-05 08:36:29.324','2026-08-05 08:36:29.324');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (56,'EMP0056','司尚宇',7,NULL,NULL,'2026-08-05 08:36:29.385','2026-08-05 08:36:29.385');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (57,'EMP0057','罗惠芙',7,NULL,NULL,'2026-08-05 08:36:29.464','2026-08-05 08:36:29.464');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (58,'EMP0058','杨程涵',7,NULL,NULL,'2026-08-05 08:36:29.575','2026-08-05 08:36:29.575');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (59,'EMP0059','田岩艳',7,NULL,NULL,'2026-08-05 08:36:29.697','2026-08-05 08:36:29.697');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (60,'EMP0060','支俊慧',7,NULL,NULL,'2026-08-05 08:36:29.739','2026-08-05 08:36:29.739');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (61,'EMP0061','武冠岐',7,NULL,NULL,'2026-08-05 08:36:29.797','2026-08-05 08:36:29.797');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (62,'EMP0062','王倩',7,NULL,NULL,'2026-08-05 08:36:29.868','2026-08-05 08:36:29.868');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (63,'EMP0063','刘柏利',8,NULL,NULL,'2026-08-05 08:36:34.773','2026-08-05 08:36:34.773');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (64,'EMP0064','郭薇',8,NULL,NULL,'2026-08-05 08:36:34.942','2026-08-05 08:36:34.942');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (65,'EMP0065','王书丽',9,NULL,NULL,'2026-08-06 02:12:41.578','2026-08-06 02:12:41.578');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (66,'EMP0066','刘学同',9,NULL,NULL,'2026-08-06 02:12:41.639','2026-08-06 02:12:41.639');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (67,'EMP0067','宋智辉',9,NULL,NULL,'2026-08-06 02:12:41.883','2026-08-06 02:12:41.883');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (68,'EMP0068','李一航',9,NULL,NULL,'2026-08-06 02:12:41.990','2026-08-06 02:12:41.990');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (69,'EMP0069','张令侠',9,NULL,NULL,'2026-08-06 02:12:42.096','2026-08-06 02:12:42.096');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (70,'EMP0070','梁玉彤',9,NULL,NULL,'2026-08-06 02:12:42.239','2026-08-06 02:12:42.239');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (71,'EMP0071','范晓雨',6,NULL,NULL,'2026-08-06 02:12:55.536','2026-09-15 03:42:18.416');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (72,'EMP0072','姜姝含',11,NULL,NULL,'2026-08-06 02:12:55.603','2026-08-06 02:12:55.603');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (73,'EMP0073','郭文杰',12,NULL,NULL,'2026-08-06 02:12:55.744','2026-08-06 02:12:55.744');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (74,'EMP0074','姜舒月',11,NULL,NULL,'2026-08-06 02:12:55.933','2026-08-06 02:12:55.933');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (76,'EMP0076','刘京',12,NULL,NULL,'2026-08-06 02:12:56.172','2026-08-06 02:12:56.172');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (77,'EMP0077','刘雅',11,NULL,NULL,'2026-08-06 02:12:56.305','2026-09-15 03:41:52.566');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (78,'EMP0078','杨娣',12,NULL,NULL,'2026-08-06 02:12:56.455','2026-09-15 03:34:05.846');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (79,'EMP0079','王培畅',10,NULL,NULL,'2026-08-06 02:12:56.555','2026-08-06 02:12:56.555');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (80,'EMP0080','于虹玉',13,NULL,NULL,'2026-08-06 02:13:00.283','2026-08-06 02:13:00.283');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (81,'EMP0081','田鹤松',13,NULL,NULL,'2026-08-06 02:30:05.981','2026-08-06 02:30:05.981');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (82,'EMP0082','曹靖宇',14,NULL,NULL,'2026-08-06 05:44:21.239','2026-08-06 05:44:21.239');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (83,'EMP0083','服务器旁',14,NULL,NULL,'2026-08-06 05:44:24.514','2026-08-06 05:44:24.514');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (84,'EMP0084','晋航帆',14,NULL,NULL,'2026-08-06 05:44:27.471','2026-08-06 05:44:27.471');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (85,'EMP0085','李策',14,NULL,NULL,'2026-08-06 05:44:30.647','2026-08-06 05:44:30.647');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (86,'EMP0086','李朔',14,NULL,NULL,'2026-08-06 05:44:34.141','2026-08-06 05:44:34.141');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (87,'EMP0087','孟石梅',14,NULL,NULL,'2026-08-06 05:44:37.664','2026-08-06 05:44:37.664');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (88,'EMP0088','乔欣颖',14,NULL,NULL,'2026-08-06 05:44:41.017','2026-08-06 05:44:41.017');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (89,'EMP0089','宋亚培',14,NULL,NULL,'2026-08-06 05:44:44.290','2026-08-06 05:44:44.290');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (90,'EMP0090','王丹',14,NULL,NULL,'2026-08-06 05:44:48.016','2026-08-06 05:44:48.016');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (91,'EMP0091','王佳琦',14,NULL,NULL,'2026-08-06 05:44:51.687','2026-08-06 05:44:51.687');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (92,'EMP0092','徐凯豪',14,NULL,NULL,'2026-08-06 05:44:55.746','2026-08-06 05:44:55.746');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (93,'EMP0093','张紫丹',14,NULL,NULL,'2026-08-06 05:45:00.187','2026-08-06 05:45:00.187');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (94,'EMP0094','赵文丽',14,NULL,NULL,'2026-08-06 05:45:03.719','2026-08-06 05:45:03.719');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (95,'EMP0095','闲置1',14,NULL,NULL,'2026-08-06 06:07:27.826','2026-08-06 06:07:27.826');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (96,'EMP0096','肖旭',14,NULL,NULL,'2026-08-06 06:07:32.136','2026-08-06 06:07:32.136');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (97,'EMP0097','陆航',15,NULL,NULL,'2026-08-06 08:51:55.262','2026-08-06 08:51:55.262');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (98,'EMP0098','李洁',15,NULL,NULL,'2026-08-06 08:51:55.322','2026-08-06 08:51:55.322');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (99,'EMP0099','申靖淼',15,NULL,NULL,'2026-08-06 08:51:55.490','2026-08-06 08:51:55.490');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (100,'EMP0100','杨淼',16,NULL,NULL,'2026-08-06 10:13:45.385','2026-08-06 10:13:45.385');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (101,'EMP0101','共享',16,NULL,NULL,'2026-08-06 10:13:45.511','2026-08-06 10:13:45.511');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (102,'EMP0102','邬重阳',16,NULL,NULL,'2026-08-06 10:13:45.643','2026-08-06 10:13:45.643');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (103,'EMP0103','刘婷.',16,NULL,NULL,'2026-08-06 10:13:45.722','2026-08-06 10:13:45.722');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (104,'EMP0104','张劭轩',16,NULL,NULL,'2026-08-06 10:13:45.788','2026-08-06 10:13:45.788');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (105,'EMP0105','张佳怡',16,NULL,NULL,'2026-08-06 10:13:45.898','2026-08-06 10:13:45.898');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (106,'EMP0106','郭建华',16,NULL,NULL,'2026-08-06 10:13:45.992','2026-08-06 10:13:45.992');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (107,'EMP0107','冯红丽',16,NULL,NULL,'2026-08-06 10:13:46.143','2026-08-06 10:13:46.143');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (108,'EMP0108','勾洋洋',16,NULL,NULL,'2026-08-06 10:13:46.281','2026-08-06 10:13:46.281');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (109,'EMP0109','刘婷',16,NULL,NULL,'2026-08-06 10:13:46.494','2026-08-06 10:13:46.494');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (110,'EMP0110','高敏',16,NULL,NULL,'2026-08-06 10:13:46.615','2026-08-06 10:13:46.615');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (111,'EMP0111','刘雅婧',17,NULL,NULL,'2026-08-07 01:38:48.870','2026-08-07 01:38:48.870');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (112,'EMP0112','尚煜函',17,NULL,NULL,'2026-08-07 01:38:49.023','2026-08-07 01:38:49.023');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (113,'EMP0113','张瑞同',17,NULL,NULL,'2026-08-07 01:38:49.187','2026-08-07 01:38:49.187');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (114,'EMP0114','闫欣宇',17,NULL,NULL,'2026-08-07 01:38:49.321','2026-08-07 01:38:49.321');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (115,'EMP0115','郭欣欣',17,NULL,NULL,'2026-08-07 01:38:49.466','2026-08-07 01:38:49.466');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (116,'EMP0116','陈爽',17,NULL,NULL,'2026-08-07 01:39:02.345','2026-08-07 01:39:02.345');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (117,'EMP0117','赵宏颖',18,NULL,NULL,'2026-08-11 03:52:21.514','2026-08-11 03:52:21.514');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (118,'EMP0118','相聪',18,NULL,NULL,'2026-08-11 03:52:26.140','2026-08-11 03:52:26.140');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (119,'EMP0119','空闲1',19,NULL,NULL,'2026-08-11 06:10:50.026','2026-08-11 06:10:50.026');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (120,'EMP0120','空闲2',19,NULL,NULL,'2026-08-11 06:10:54.948','2026-08-11 06:10:54.948');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (121,'EMP0121','空闲3',19,NULL,NULL,'2026-08-11 06:10:58.228','2026-08-11 06:10:58.228');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (122,'EMP0122','空闲4',19,NULL,NULL,'2026-08-11 06:11:01.408','2026-08-11 06:11:01.408');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (123,'EMP0123','程哥',18,NULL,NULL,'2026-08-11 06:35:08.447','2026-08-11 06:35:08.447');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (124,'EMP0124','会议室戴尔笔记本',20,NULL,NULL,'2026-08-12 02:14:37.217','2026-08-12 02:14:37.217');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (125,'EMP0125','会议室联想笔记本',20,NULL,NULL,'2026-08-12 02:14:48.093','2026-08-12 02:14:48.093');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (126,'EMP0126','赵颖',21,NULL,NULL,'2026-08-13 06:18:41.748','2026-08-13 06:18:41.748');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (127,'EMP0127','杜晨阳',21,NULL,NULL,'2026-08-13 06:18:41.870','2026-08-13 06:18:41.870');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (128,'EMP0128','刘千慧',21,NULL,NULL,'2026-08-13 06:18:41.967','2026-08-13 06:18:41.967');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (129,'EMP0129','韩洪宇',21,NULL,NULL,'2026-08-13 06:18:42.096','2026-08-13 06:18:42.096');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (130,'EMP0130','张钰',21,NULL,NULL,'2026-08-13 06:19:34.910','2026-08-13 06:19:34.910');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (131,'EMP0131','罗文',2,NULL,NULL,'2026-08-31 01:17:02.318','2026-08-31 01:17:02.318');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (132,'EMP0132','1',22,NULL,NULL,'2026-09-10 07:23:45.079','2026-09-10 07:23:45.079');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (133,'EMP0133','12',22,NULL,NULL,'2026-09-11 08:53:36.683','2026-09-11 08:53:36.683');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (134,'EMP0134','员工001',23,NULL,NULL,'2026-09-15 01:42:39.608','2026-09-15 01:42:39.608');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (135,'EMP0135','员工002',23,NULL,NULL,'2026-09-15 01:42:49.573','2026-09-15 01:42:49.573');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (136,'EMP0136','员工003',23,NULL,NULL,'2026-09-15 01:43:02.428','2026-09-15 01:43:02.428');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (137,'EMP0137','员工004',23,NULL,NULL,'2026-09-15 01:43:15.081','2026-09-15 01:43:15.081');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (138,'EMP0138','员工005',23,NULL,NULL,'2026-09-15 01:43:24.668','2026-09-15 01:43:24.668');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (139,'EMP0139','员工006',23,NULL,NULL,'2026-09-15 01:43:34.927','2026-09-15 01:43:34.927');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (140,'EMP0140','员工007',23,NULL,NULL,'2026-09-15 01:43:47.406','2026-09-15 01:43:47.406');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (141,'EMP0141','员工008',23,NULL,NULL,'2026-09-15 01:44:05.596','2026-09-15 01:44:05.596');
INSERT INTO `Employee` (`id`,`employeeNo`,`name`,`departmentId`,`phone`,`email`,`createdAt`,`updatedAt`) VALUES (142,'EMP0142','王宇轩',2,NULL,NULL,'2026-09-17 08:37:20.379','2026-09-17 08:37:20.379');

-- 配件分类 ComponentCategory
INSERT INTO `ComponentCategory` (`id`,`name`,`parentId`,`createdAt`,`updatedAt`) VALUES (1,'CPU',NULL,'2026-08-05 08:35:19.293','2026-08-05 08:35:19.293');
INSERT INTO `ComponentCategory` (`id`,`name`,`parentId`,`createdAt`,`updatedAt`) VALUES (2,'内存',NULL,'2026-08-05 08:35:19.305','2026-08-05 08:35:19.305');
INSERT INTO `ComponentCategory` (`id`,`name`,`parentId`,`createdAt`,`updatedAt`) VALUES (3,'硬盘',NULL,'2026-08-05 08:35:19.311','2026-08-05 08:35:19.311');
INSERT INTO `ComponentCategory` (`id`,`name`,`parentId`,`createdAt`,`updatedAt`) VALUES (4,'显示器',NULL,'2026-08-05 08:35:19.318','2026-08-05 08:35:19.318');
INSERT INTO `ComponentCategory` (`id`,`name`,`parentId`,`createdAt`,`updatedAt`) VALUES (5,'主板',NULL,'2026-08-05 08:35:19.324','2026-08-05 08:35:19.324');
INSERT INTO `ComponentCategory` (`id`,`name`,`parentId`,`createdAt`,`updatedAt`) VALUES (6,'显卡',NULL,'2026-08-05 08:35:19.332','2026-08-05 08:35:19.332');
INSERT INTO `ComponentCategory` (`id`,`name`,`parentId`,`createdAt`,`updatedAt`) VALUES (7,'键盘',NULL,'2026-09-11 04:16:39.836','2026-09-11 04:16:39.836');
INSERT INTO `ComponentCategory` (`id`,`name`,`parentId`,`createdAt`,`updatedAt`) VALUES (8,'鼠标',NULL,'2026-09-11 04:16:45.254','2026-09-11 04:16:45.254');

-- 配件型号 ComponentModel
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (50,'11th Gen Intel Core i5-11400 @ 2.60GHz','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (36,'12th Gen Intel Core i3-12100','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (28,'12th Gen Intel Core i3-12100F','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (46,'12th Gen Intel Core i5-12400','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (19,'12th Gen Intel Core i5-12400F','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (24,'Intel Core i3-9100 CPU @ 3.60GHz','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (74,'Intel Core i5-4460 CPU @ 3.20GHz','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (88,'Intel Core i5-4590 CPU @ 3.30GHz','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (32,'Intel Core i5-6400 CPU @ 2.70GHz','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (101,'Intel Core i5-6400T CPU @ 2.20GHz','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (13,'Intel Core i5-6500 CPU @ 3.20GHz','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (128,'Intel Core i5-6600 CPU @ 3.30GHz','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (1,'Intel Core i5-9500 CPU @ 3.00GHz','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (111,'Intel Core i7-10700K CPU @ 3.80GHz','GenuineIntel',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (94,'未知CPU','未知',1);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (2,'16GB','未知',2);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (112,'16GB DDR2666MHz','Kingston',2);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (106,'16GB DDR3200MHz','Colorful Technology Ltd',2);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (14,'4GB','未知',2);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (7,'8GB','未知',2);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (116,'8GB DDR2133MHz','88BC',2);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (115,'8GB DDR2667MHz','08C8',2);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (109,'8GB DDR3200MHz','8A97',2);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (53,'未知','未知',2);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (95,'未知内存','未知',2);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (75,'111GB HDD (KINGSTON)','KINGSTON',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (56,'111GB HDD (Teelkoou)','Teelkoou',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (89,'111GB SSD (Getrich)','Getrich',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (85,'119GB HDD (Colorful)','Colorful',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (86,'119GB HDD (Teelkoou)','Teelkoou',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (102,'223GB HDD (KINGSTON)','KINGSTON',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (62,'223GB SSD (Lenovo)','Lenovo',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (33,'223GB SSD (SSD)','SSD',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (68,'232GB SSD (CT250MX500SSD1)','CT250MX500SSD1',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (82,'238GB HDD (CF500)','CF500',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (29,'238GB HDD (Colorful)','Colorful',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (79,'238GB HDD (Great)','Great',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (91,'238GB HDD (JISHUN)','JISHUN',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (3,'238GB SSD (Dahua)','Dahua',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (48,'238GB SSD (Hixa)','Hixa',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (15,'238GB SSD (SSD)','SSD',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (63,'3102','LENOVO',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (10,'465GB HDD (Colorful)','Colorful',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (113,'465GB HDD (KINGSTON)','Kingston',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (99,'465GB HDD (ST3500413AS)','ST3500413AS',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (25,'476GB HDD (Colorful)','Colorful',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (51,'476GB SSD (Dahua)','Dahua',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (20,'931GB SSD (Lexar)','Lexar',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (71,'953GB SSD (Dahua)','Dahua',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (58,'未知硬盘','未知',3);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (27,'2180W','AOC',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (76,'2260W','AOC',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (41,'2270W','AOC',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (118,'22EN33','GSM',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (83,'2402','SAS',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (66,'Acer K222HQL','ACR',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (18,'ͨü弴ü','未知',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (34,'E2211L','HSO',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (42,'HP P221','HWP',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (93,'HP Z22i','HWP',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (45,'JQA22F','SAT',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (11,'KV246','KVL',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (44,'LED MONITOR','SAC',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (54,'LEN L2232wD','LEN',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (104,'LEN LS2224A','LEN',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (8,'LEN T2224rbA','LEN',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (12,'M21SD','CMC',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (21,'PHL 241V8B','PHL',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (65,'S22B150','SAM',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (57,'S22B300','SAM',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (37,'S22C150','SAM',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (40,'S22D300','SAM',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (84,'V2243WS','CGC',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (59,'VA2759 Series','VSC',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (108,'未知','未知',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (60,'未知显示器','未知',4);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (92,'2B5E','HP',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (67,'3102','LENOVO',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (69,'83EE','HP',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (80,'B150M-K','ASUSTeK COMPUTER INC.',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (87,'B250M-HD3-CF','Gigabyte Technology Co., Ltd.',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (114,'B460M AORUS ELITE','Gigabyte Technology Co., Ltd.',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (105,'B85M-D2V','Gigabyte Technology Co., Ltd.',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (103,'EX-B250M-V3','ASUSTeK COMPUTER INC.',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (26,'H110','KOLOE',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (70,'H110M-F','ASUSTeK COMPUTER INC.',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (55,'H110M-K','ASUSTeK COMPUTER INC.',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (35,'H110M-S2-CF','Gigabyte Technology Co., Ltd.',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (5,'H311M-A','INBA',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (9,'H311M-PLUS D4-K','INBA',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (30,'H610E','Onda technology corporation',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (22,'H610M K DDR4','Gigabyte Technology Co., Ltd.',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (49,'H610M Plus','Intel',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (72,'H610M-D','Colorful Technology And Development Co.,LTD',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (38,'H610M-D EVO','Colorful Technology And Development Co.,LTD',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (119,'H610M-E M.2','Colorful Technology And Development Co.,LTD',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (47,'H610M-PRO K STARS','INBA',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (16,'INBA','INBA',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (52,'PRIME H510M-K R2.0','ASUSTeK COMPUTER INC.',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (100,'PRIME H610M-F D4 R2.0','未知',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (77,'SHARKBAY','LENOVO',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (96,'未知主板','未知',5);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (73,'GameViewer Virtual Display Adapter (1GB)','未知',6);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (78,'Intel(R) HD Graphics 4600','Intel',6);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (17,'Intel(R) HD Graphics 530','Intel',6);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (6,'Intel(R) UHD Graphics 630','Intel',6);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (39,'Intel(R) UHD Graphics 730','Intel',6);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (81,'Microsoft ʾ','未知',6);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (23,'NVIDIA GeForce GTX 1660','NVIDIA',6);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (31,'OrayIddDriver Device (1GB)','未知',6);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (123,'双飞燕键盘','双飞燕',7);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (125,'悉硕键盘','悉硕',7);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (127,'惠普键盘','惠普',7);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (126,'戴尔键盘','戴尔',7);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (124,'罗技键盘','罗技',7);
INSERT INTO `ComponentModel` (`id`,`name`,`brand`,`categoryId`) VALUES (129,'飞利浦鼠标','飞利浦',8);

-- 配件库存 ComponentStock
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (1,1,1,'2026-08-05 08:35:19.297');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (2,2,1,'2026-08-05 08:35:19.307');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (3,3,1,'2026-08-05 08:35:19.314');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (5,5,1,'2026-08-05 08:35:19.327');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (6,6,1,'2026-08-05 08:35:19.334');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (7,7,1,'2026-08-05 08:35:19.394');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (8,8,2,'2026-09-17 06:39:00.845');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (9,9,1,'2026-08-05 08:35:19.492');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (10,10,1,'2026-08-05 08:35:19.582');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (11,11,1,'2026-08-05 08:35:24.158');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (12,12,1,'2026-08-05 08:35:24.446');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (13,13,1,'2026-08-05 08:35:24.552');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (14,14,1,'2026-08-05 08:35:24.566');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (15,15,1,'2026-08-05 08:35:24.579');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (16,16,1,'2026-08-05 08:35:24.598');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (17,17,2,'2026-09-17 06:39:00.852');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (18,18,1,'2026-08-05 08:35:24.819');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (19,19,1,'2026-08-05 08:35:24.996');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (20,20,1,'2026-08-05 08:35:25.015');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (21,21,1,'2026-08-05 08:35:25.028');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (22,22,1,'2026-08-05 08:35:25.041');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (23,23,1,'2026-08-05 08:35:25.054');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (24,24,1,'2026-08-05 08:35:25.764');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (25,25,1,'2026-08-05 08:35:25.806');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (26,26,1,'2026-08-05 08:35:25.824');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (27,27,1,'2026-08-05 08:35:25.962');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (28,28,1,'2026-08-05 08:35:36.075');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (29,29,1,'2026-08-05 08:35:36.081');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (30,30,1,'2026-08-05 08:35:36.088');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (31,31,1,'2026-08-05 08:35:36.092');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (32,32,1,'2026-08-05 08:35:36.130');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (33,33,1,'2026-08-05 08:35:36.139');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (34,34,1,'2026-08-05 08:35:36.148');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (35,35,1,'2026-08-05 08:35:36.160');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (36,36,2,'2026-09-17 06:39:00.832');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (37,37,1,'2026-08-05 08:35:36.276');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (38,38,1,'2026-08-05 08:35:36.288');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (39,39,1,'2026-08-05 08:35:36.303');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (40,40,1,'2026-08-05 08:35:36.403');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (41,41,1,'2026-08-05 08:35:36.521');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (42,42,1,'2026-08-05 08:35:36.632');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (44,44,1,'2026-08-05 08:35:44.437');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (45,45,1,'2026-08-05 08:35:44.703');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (46,46,1,'2026-08-05 08:36:18.883');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (47,47,1,'2026-08-05 08:36:18.898');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (48,48,1,'2026-08-05 08:36:18.980');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (49,49,1,'2026-08-05 08:36:18.998');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (50,50,1,'2026-08-05 08:36:23.703');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (51,51,1,'2026-08-05 08:36:23.712');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (52,52,1,'2026-08-05 08:36:23.718');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (53,53,1,'2026-08-05 08:36:23.797');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (54,54,2,'2026-09-17 05:55:35.106');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (55,55,1,'2026-08-05 08:36:23.995');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (56,56,1,'2026-08-05 08:36:24.119');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (57,57,1,'2026-08-05 08:36:24.316');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (58,58,1,'2026-08-05 08:36:29.302');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (59,59,1,'2026-08-05 08:36:29.306');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (60,60,3,'2026-09-17 05:55:35.151');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (62,62,1,'2026-08-05 08:36:34.746');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (63,63,1,'2026-08-05 08:36:34.868');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (65,65,1,'2026-08-05 08:36:34.893');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (66,66,1,'2026-08-06 02:12:41.781');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (67,67,1,'2026-08-06 02:12:42.176');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (68,68,1,'2026-08-06 02:12:55.514');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (69,69,1,'2026-08-06 02:12:55.520');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (70,70,1,'2026-08-06 02:12:56.526');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (71,71,1,'2026-08-06 02:30:05.953');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (72,72,1,'2026-08-06 02:30:05.960');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (73,73,1,'2026-08-06 02:30:05.964');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (74,74,1,'2026-08-06 05:44:21.185');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (75,75,2,'2026-09-17 05:59:16.534');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (76,76,1,'2026-08-06 05:44:21.208');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (77,77,1,'2026-08-06 05:44:21.212');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (78,78,1,'2026-08-06 05:44:21.217');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (79,79,1,'2026-08-06 05:44:27.444');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (80,80,1,'2026-08-06 05:44:27.451');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (81,81,1,'2026-08-06 05:44:27.455');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (82,82,1,'2026-08-06 05:44:34.115');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (83,83,1,'2026-08-06 05:44:34.119');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (84,84,1,'2026-08-06 05:44:37.642');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (85,85,1,'2026-08-06 05:44:40.988');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (86,86,1,'2026-08-06 05:44:40.994');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (87,87,1,'2026-08-06 05:44:41.000');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (88,88,1,'2026-08-06 05:44:44.249');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (89,89,1,'2026-08-06 05:44:44.264');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (91,91,1,'2026-08-06 05:45:00.155');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (92,92,1,'2026-08-06 05:45:00.162');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (93,93,1,'2026-08-06 06:07:27.795');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (94,94,1,'2026-08-06 06:07:32.106');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (95,95,1,'2026-08-06 06:07:32.110');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (96,96,1,'2026-08-06 06:07:32.119');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (99,99,1,'2026-08-06 08:51:55.229');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (100,100,2,'2026-09-17 05:55:35.159');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (101,101,1,'2026-08-06 10:13:45.347');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (102,102,1,'2026-08-06 10:13:45.358');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (103,103,1,'2026-08-06 10:13:45.364');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (104,104,1,'2026-08-06 10:13:45.448');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (105,105,1,'2026-08-06 10:13:45.954');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (106,106,3,'2026-09-17 06:39:00.861');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (108,108,1,'2026-08-07 01:38:48.920');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (109,109,2,'2026-09-17 05:55:35.096');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (111,111,1,'2026-08-07 01:39:02.307');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (112,112,2,'2026-08-07 01:39:50.663');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (113,113,1,'2026-08-07 01:39:02.320');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (114,114,1,'2026-08-07 01:39:02.326');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (115,115,2,'2026-09-17 05:55:35.087');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (116,116,2,'2026-09-17 05:55:35.082');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (118,118,1,'2026-08-13 06:18:41.711');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (119,119,1,'2026-08-13 06:18:41.717');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (123,123,12,'2026-09-15 04:19:40.198');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (124,124,1,'2026-09-11 04:40:13.404');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (125,125,9,'2026-09-11 04:40:25.110');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (126,126,1,'2026-09-11 04:40:35.715');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (127,127,4,'2026-09-15 01:32:57.767');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (128,128,1,'2026-09-11 08:53:36.650');
INSERT INTO `ComponentStock` (`id`,`modelId`,`quantity`,`updatedAt`) VALUES (129,129,19,'2026-09-17 08:42:08.737');

-- 库存流水 ComponentStockLog
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (1,1,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:19.300');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (2,2,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:19.309');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (3,3,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:19.315');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (4,60,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:19.322');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (5,5,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:19.329');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (6,6,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:19.336');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (7,7,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:19.396');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (8,8,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:19.485');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (9,9,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:19.495');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (10,10,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:19.587');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (11,11,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:24.159');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (12,12,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:24.451');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (13,13,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:24.557');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (14,14,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:24.570');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (15,15,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:24.584');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (16,16,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:24.603');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (17,17,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:24.617');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (18,18,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:24.825');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (19,19,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:25.001');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (20,20,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:25.019');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (21,21,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:25.032');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (22,22,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:25.045');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (23,23,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:25.059');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (24,24,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:25.792');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (25,25,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:25.810');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (26,26,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:25.828');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (27,27,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:25.967');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (28,28,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.077');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (29,29,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.083');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (30,30,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.089');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (31,31,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.093');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (32,32,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.132');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (33,33,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.141');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (34,34,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.152');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (35,35,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.165');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (36,36,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.258');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (37,37,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.280');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (38,38,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.293');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (39,39,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.308');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (40,40,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.408');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (41,41,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.527');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (42,42,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:36.634');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (43,100,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:43.691');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (44,44,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:44.442');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (45,45,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:35:44.708');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (46,46,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:18.885');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (47,47,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:18.901');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (48,48,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:18.984');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (49,49,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:19.003');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (50,50,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:23.705');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (51,51,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:23.713');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (52,52,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:23.719');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (53,53,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:23.811');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (54,54,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:23.987');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (55,55,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:24.000');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (56,56,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:24.124');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (57,57,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:24.321');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (58,58,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:29.304');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (59,59,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:29.308');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (60,60,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:29.360');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (61,60,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:29.644');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (62,62,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:34.748');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (63,63,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:34.873');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (64,17,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:34.885');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (65,65,'PURCHASE_IN',1,'system','自动导入创建','2026-08-05 08:36:34.898');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (66,66,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 02:12:41.788');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (67,67,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 02:12:42.181');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (68,68,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 02:12:55.515');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (69,69,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 02:12:55.521');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (70,70,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 02:12:56.530');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (71,71,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 02:30:05.955');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (72,72,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 02:30:05.962');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (73,73,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 02:30:05.966');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (74,74,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:21.187');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (75,75,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:21.205');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (76,76,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:21.210');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (77,77,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:21.214');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (78,78,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:21.219');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (79,79,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:27.445');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (80,80,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:27.452');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (81,81,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:27.457');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (82,82,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:34.116');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (83,83,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:34.121');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (84,84,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:37.644');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (85,85,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:40.990');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (86,86,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:40.995');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (87,87,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:41.001');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (88,88,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:44.251');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (89,89,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:44.266');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (90,75,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:44:44.271');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (91,91,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:45:00.157');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (92,92,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 05:45:00.164');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (93,93,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 06:07:27.797');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (94,94,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 06:07:32.107');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (95,95,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 06:07:32.112');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (96,96,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 06:07:32.120');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (97,36,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 08:51:55.221');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (98,106,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 08:51:55.226');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (99,99,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 08:51:55.231');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (100,100,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 08:51:55.241');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (101,101,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 10:13:45.349');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (102,102,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 10:13:45.359');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (103,103,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 10:13:45.365');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (104,104,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 10:13:45.453');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (105,105,'PURCHASE_IN',1,'system','自动导入创建','2026-08-06 10:13:45.956');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (106,106,'PURCHASE_IN',1,'system','自动导入创建','2026-08-07 01:38:48.842');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (107,106,'PURCHASE_IN',1,'system','自动导入创建','2026-08-07 01:38:48.912');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (108,108,'PURCHASE_IN',1,'system','自动导入创建','2026-08-07 01:38:48.924');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (109,109,'PURCHASE_IN',1,'system','自动导入创建','2026-08-07 01:38:49.248');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (110,109,'PURCHASE_IN',1,'system','自动导入创建','2026-08-07 01:38:49.380');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (111,111,'PURCHASE_IN',1,'system','自动导入创建','2026-08-07 01:39:02.309');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (112,112,'PURCHASE_IN',1,'system','自动导入创建','2026-08-07 01:39:02.313');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (113,113,'PURCHASE_IN',1,'system','自动导入创建','2026-08-07 01:39:02.321');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (114,114,'PURCHASE_IN',1,'system','自动导入创建','2026-08-07 01:39:02.327');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (115,112,'UPGRADE_RETURN',1,'admin',NULL,'2026-08-07 01:39:50.666');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (116,115,'PURCHASE_IN',1,'system','自动导入创建','2026-08-11 03:52:21.485');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (117,116,'PURCHASE_IN',1,'system','自动导入创建','2026-08-11 06:10:49.994');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (118,8,'PURCHASE_IN',1,'system','自动导入创建','2026-08-11 06:10:50.001');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (119,118,'PURCHASE_IN',1,'system','自动导入创建','2026-08-13 06:18:41.713');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (120,119,'PURCHASE_IN',1,'system','自动导入创建','2026-08-13 06:18:41.719');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (121,115,'PURCHASE_IN',1,'system','自动导入创建','2026-08-13 06:18:41.798');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (122,54,'PURCHASE_IN',1,'system','自动导入创建','2026-08-13 06:18:41.912');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (123,116,'PURCHASE_IN',1,'system','自动导入创建','2026-08-13 06:19:34.878');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (124,123,'PURCHASE_IN',1,'admin',NULL,'2026-09-11 04:27:14.755');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (125,123,'UPGRADE_USE',-1,'admin',NULL,'2026-09-11 04:27:36.849');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (126,123,'PURCHASE_IN',12,'admin',NULL,'2026-09-11 04:40:05.951');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (127,124,'PURCHASE_IN',1,'admin',NULL,'2026-09-11 04:40:13.406');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (128,125,'PURCHASE_IN',9,'admin',NULL,'2026-09-11 04:40:25.111');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (129,126,'PURCHASE_IN',1,'admin',NULL,'2026-09-11 04:40:35.717');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (130,127,'PURCHASE_IN',3,'admin',NULL,'2026-09-11 04:41:07.780');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (131,123,'PURCHASE_IN',1,'admin',NULL,'2026-09-11 04:44:44.282');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (132,128,'PURCHASE_IN',1,'system','自动导入创建','2026-09-11 08:53:36.653');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (133,127,'PURCHASE_IN',1,'admin',NULL,'2026-09-15 01:32:57.769');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (134,123,'UPGRADE_USE',-1,'admin',NULL,'2026-09-15 04:19:40.201');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (135,129,'PURCHASE_IN',20,'admin',NULL,'2026-09-16 03:05:34.685');
INSERT INTO `ComponentStockLog` (`id`,`modelId`,`type`,`quantity`,`operator`,`remark`,`createdAt`) VALUES (136,129,'UPGRADE_USE',-1,'admin',NULL,'2026-09-17 08:42:08.743');

-- 设备分类 AssetCategory（旧列 is_unique → 新列 is_unique）
INSERT INTO `AssetCategory` (`id`,`name`,`code`,`is_unique`,`parentId`,`numberingRule`,`createdAt`,`updatedAt`) VALUES (1,'计算机设备','DN',0,NULL,'{prefix}-{R6}','2026-08-05 08:31:42.088','2026-08-05 08:31:42.088');
INSERT INTO `AssetCategory` (`id`,`name`,`code`,`is_unique`,`parentId`,`numberingRule`,`createdAt`,`updatedAt`) VALUES (2,'电脑主机','DT',1,1,'{prefix}-{R6}','2026-08-05 08:31:42.106','2026-09-12 07:33:26.381');
INSERT INTO `AssetCategory` (`id`,`name`,`code`,`is_unique`,`parentId`,`numberingRule`,`createdAt`,`updatedAt`) VALUES (3,'笔记本','NB',0,1,'{prefix}-{R6}','2026-08-05 08:31:42.129','2026-09-12 07:32:56.659');
INSERT INTO `AssetCategory` (`id`,`name`,`code`,`is_unique`,`parentId`,`numberingRule`,`createdAt`,`updatedAt`) VALUES (4,'网络设备','WL',0,NULL,'{prefix}-{R6}','2026-08-05 08:31:42.149','2026-08-05 08:31:42.149');
INSERT INTO `AssetCategory` (`id`,`name`,`code`,`is_unique`,`parentId`,`numberingRule`,`createdAt`,`updatedAt`) VALUES (5,'交换机','SW',0,4,'{prefix}-{R6}','2026-08-05 08:31:42.175','2026-08-05 08:31:42.175');
INSERT INTO `AssetCategory` (`id`,`name`,`code`,`is_unique`,`parentId`,`numberingRule`,`createdAt`,`updatedAt`) VALUES (6,'办公设备','BG',0,NULL,'{prefix}-{R6}','2026-08-05 08:31:42.201','2026-08-05 08:31:42.201');
INSERT INTO `AssetCategory` (`id`,`name`,`code`,`is_unique`,`parentId`,`numberingRule`,`createdAt`,`updatedAt`) VALUES (7,'打印机','PR',0,6,'{prefix}-{R6}','2026-08-05 08:31:42.224','2026-08-05 08:31:42.224');

-- 设备模板 DeviceTemplate（去掉旧版 normalizedName 生成列）
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (1,'电脑主机 (i5-9500)',2,'2026-08-05 08:35:19.342','2026-09-17 06:39:00.674');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (9,'电脑主机 (i5-6500)',2,'2026-08-05 08:35:24.744','2026-09-17 06:39:00.698');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (11,'电脑主机 (i5-12400F)',2,'2026-08-05 08:35:25.075','2026-09-17 06:39:00.777');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (14,'电脑主机 (i3-9100)',2,'2026-08-05 08:35:25.850','2026-09-17 06:39:00.779');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (16,'电脑主机 (i3-12100F)',2,'2026-08-05 08:35:36.099','2026-09-17 06:39:00.780');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (31,'电脑主机 (i5-12400)',2,'2026-08-05 08:36:18.917','2026-09-17 06:39:00.755');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (33,'电脑主机 (11th)',2,'2026-08-05 08:36:23.729','2026-09-17 06:39:00.782');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (34,'电脑主机 (i3-12100)',2,'2026-08-05 08:36:23.854','2026-09-17 06:39:00.748');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (59,'电脑主机 (i5-4460)',2,'2026-08-06 05:44:21.229','2026-09-17 06:39:00.766');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (61,'电脑主机 (i5-6400)',2,'2026-08-06 05:44:27.466','2026-09-17 06:39:00.733');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (66,'电脑主机 (i5-4590)',2,'2026-08-06 05:44:44.285','2026-09-17 06:39:00.783');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (73,'电脑主机 (未知CPU)',2,'2026-08-06 06:07:32.130','2026-09-17 06:39:00.785');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (76,'电脑主机 (i5-6400T)',2,'2026-08-06 10:13:45.378','2026-09-17 06:39:00.775');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (91,'电脑主机 (i7-10700K)',2,'2026-08-07 01:39:02.341','2026-09-17 06:39:00.787');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (92,'电脑主机',2,'2026-08-11 03:38:48.518','2026-08-11 03:38:48.518');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (95,'戴尔笔记本',3,'2026-08-11 05:07:03.524','2026-08-11 05:07:03.524');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (96,'联想笔记本',3,'2026-08-11 05:07:19.054','2026-08-11 05:07:19.054');
INSERT INTO `DeviceTemplate` (`id`,`name`,`categoryId`,`createdAt`,`updatedAt`) VALUES (107,'电脑主机 (i5-6600)',2,'2026-09-11 08:53:36.677','2026-09-17 06:39:00.788');

-- 模板配件 BOM TemplateComponent
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (1,1,1,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (5,1,5,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (6,1,6,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (50,9,13,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (54,9,9,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (55,9,17,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (62,11,19,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (63,11,2,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (64,11,20,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (66,11,22,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (67,11,23,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (80,14,24,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (81,14,2,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (82,14,25,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (84,14,26,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (85,14,6,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (92,16,28,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (93,16,2,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (94,16,29,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (96,16,30,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (97,16,31,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (182,31,46,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (186,31,47,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (187,31,39,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (194,33,50,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (195,33,7,2);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (196,33,51,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (198,33,52,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (199,33,39,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (200,34,36,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (205,34,38,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (206,34,39,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (358,59,74,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (363,59,77,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (364,59,78,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (371,61,32,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (375,61,80,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (376,61,81,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (403,66,88,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (404,66,14,4);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (405,66,7,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (406,66,89,2);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (407,66,75,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (409,66,77,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (410,66,78,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (447,73,94,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (448,73,95,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (449,73,51,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (451,73,96,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (465,76,101,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (469,76,103,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (470,76,81,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (555,91,111,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (556,91,112,3);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (557,91,113,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (559,91,114,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (560,91,6,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (634,107,128,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (635,107,116,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (636,107,82,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (638,107,55,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (639,107,81,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (646,1,2,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (647,1,3,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (648,9,3,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (649,9,7,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (650,31,2,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (651,31,3,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (652,34,2,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (653,34,51,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (654,59,14,2);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (655,59,29,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (656,61,7,3);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (657,61,82,1);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (658,76,7,3);
INSERT INTO `TemplateComponent` (`id`,`templateId`,`modelId`,`quantity`) VALUES (659,76,82,1);

-- 资产 Asset
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (1,'DT-2JG4DG','刘源的电脑主机',1,'IN_USE',1,NULL,NULL,NULL,NULL,'2026-08-05 08:35:19.355','2026-08-05 08:35:19.355');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (2,'DT-7SUWHC','张艳茹的电脑主机',1,'IN_USE',2,NULL,NULL,NULL,NULL,'2026-08-05 08:35:19.436','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (3,'DT-7ZE5CW','李佳的电脑主机',1,'IN_USE',3,NULL,NULL,NULL,NULL,'2026-08-05 08:35:19.530','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (4,'DT-AAQPKU','罗文',1,'IN_USE',131,NULL,NULL,NULL,NULL,'2026-08-05 08:35:19.652','2026-09-17 06:39:00.660');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (5,'DT-XAK3KU','赵闯的电脑主机',1,'IN_USE',5,NULL,NULL,NULL,NULL,'2026-08-05 08:35:24.181','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (6,'DT-8GPUZW','秦梓涵的电脑主机',1,'IN_USE',6,NULL,NULL,NULL,NULL,'2026-08-05 08:35:24.278','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (7,'DT-M2T3FR','李一娜的电脑主机',1,'IN_USE',7,NULL,NULL,NULL,NULL,'2026-08-05 08:35:24.374','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (8,'DT-UXSR7U','周丽的电脑主机',1,'IN_USE',8,NULL,NULL,NULL,NULL,'2026-08-05 08:35:24.512','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (9,'DT-QYUCK8','宋恬的电脑主机',9,'IN_USE',9,NULL,NULL,NULL,NULL,'2026-08-05 08:35:24.655','2026-09-17 06:39:00.680');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (10,'DT-8P24V5','张良爽的电脑主机',1,'IN_USE',10,NULL,NULL,NULL,NULL,'2026-08-05 08:35:24.702','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (11,'DT-AJJNH3','袁雯珊的电脑主机',9,'IN_USE',11,NULL,NULL,NULL,NULL,'2026-08-05 08:35:24.756','2026-08-05 08:35:24.756');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (12,'DT-T4G3NF','魏栩莹的电脑主机',1,'IN_USE',12,NULL,NULL,NULL,NULL,'2026-08-05 08:35:24.901','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (13,'DT-9WK2V9','韩晓林的电脑主机',11,'IN_USE',13,NULL,NULL,NULL,NULL,'2026-08-05 08:35:25.096','2026-08-05 08:35:25.096');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (14,'DT-7H6D28','王璐瑀的电脑主机',1,'IN_USE',14,NULL,NULL,NULL,NULL,'2026-08-05 08:35:25.218','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (15,'DT-ESZ83T','陈凯月的电脑主机',1,'IN_USE',15,NULL,NULL,NULL,NULL,'2026-08-05 08:35:25.315','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (16,'DT-SZSXN2','王畅的电脑主机',1,'IN_USE',16,NULL,NULL,NULL,NULL,'2026-08-05 08:35:25.411','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (17,'DT-5R6KT3','王艳华的电脑主机',9,'IN_USE',17,NULL,NULL,NULL,NULL,'2026-08-05 08:35:25.519','2026-09-17 05:55:35.052');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (18,'DT-Q5KC8P','乔雪坤的电脑主机',1,'IN_USE',18,NULL,NULL,NULL,NULL,'2026-08-05 08:35:25.630','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (19,'DT-5AEY9C','黑德凯的电脑主机',1,'IN_USE',19,NULL,NULL,NULL,NULL,'2026-08-05 08:35:25.728','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (20,'DT-BUCF2K','徐佳红的电脑主机',14,'IN_USE',20,NULL,NULL,NULL,NULL,'2026-08-05 08:35:25.872','2026-08-05 08:35:25.872');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (21,'DT-KPZUTE','王星戈的电脑主机',1,'IN_USE',21,NULL,NULL,NULL,NULL,'2026-08-05 08:35:26.040','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (22,'DT-7EVDDZ','宫庆芳的电脑主机',1,'IN_USE',22,NULL,NULL,NULL,NULL,'2026-08-05 08:35:26.141','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (23,'DT-TCGVVH','代城昊的电脑主机',1,'IN_USE',23,NULL,NULL,NULL,NULL,'2026-08-05 08:35:26.204','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (24,'DT-KZ3VDN','高海兰的电脑主机',1,'IN_USE',24,NULL,NULL,NULL,NULL,'2026-08-05 08:35:26.267','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (25,'DT-G9N4PB','祖国庆的电脑主机',16,'IN_USE',25,NULL,NULL,NULL,NULL,'2026-08-05 08:35:36.106','2026-08-05 08:35:36.106');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (26,'DT-546KZE','刘美宁的电脑主机',61,'IN_USE',26,NULL,NULL,NULL,NULL,'2026-08-05 08:35:36.211','2026-09-17 06:39:00.703');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (27,'DT-HXXPJ9','王镜淇的电脑主机',34,'IN_USE',27,NULL,NULL,NULL,NULL,'2026-08-05 08:35:36.346','2026-09-17 06:39:00.735');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (28,'DT-ZARUK8','刘航的电脑主机',9,'IN_USE',28,NULL,NULL,NULL,NULL,'2026-08-05 08:35:36.464','2026-09-17 05:55:35.052');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (29,'DT-Q8W4FP','任雅瑞的电脑主机',34,'IN_USE',29,NULL,NULL,NULL,NULL,'2026-08-05 08:35:36.557','2026-09-17 06:39:00.735');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (30,'DT-J7TKFV','赵鹏瑾的电脑主机',9,'IN_USE',30,NULL,NULL,NULL,NULL,'2026-08-05 08:35:36.600','2026-09-17 06:39:00.678');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (31,'DT-6TJ2RA','韩熹晨的电脑主机',9,'IN_USE',31,NULL,NULL,NULL,NULL,'2026-08-05 08:35:36.662','2026-09-17 06:39:00.678');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (32,'DT-76H9DN','李怡庆的电脑主机',34,'IN_USE',32,NULL,NULL,NULL,NULL,'2026-08-05 08:35:43.709','2026-09-17 06:39:00.735');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (33,'DT-3CYBDN','闲置',9,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-05 08:35:43.874','2026-09-17 05:55:35.052');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (34,'DT-Z8FHKK','梁子丹的电脑主机',1,'IN_USE',34,NULL,NULL,NULL,NULL,'2026-08-05 08:35:44.120','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (35,'DT-6ZCP9T','张依的电脑主机',1,'IN_USE',35,NULL,NULL,NULL,NULL,'2026-08-05 08:35:44.256','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (36,'DT-3VU2F6','倪紫韵的电脑主机',1,'IN_USE',36,NULL,NULL,NULL,NULL,'2026-08-05 08:35:44.384','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (37,'DT-2MB9PD','郑永蔷的电脑主机',1,'IN_USE',37,NULL,NULL,NULL,NULL,'2026-08-05 08:35:44.529','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (38,'DT-H39VNX','闲置',61,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-05 08:35:44.642','2026-09-17 06:39:00.700');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (39,'DT-6WAUCV','袁永超的电脑主机',9,'IN_USE',39,NULL,NULL,NULL,NULL,'2026-08-05 08:35:44.768','2026-09-17 06:39:00.678');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (40,'DT-CJKTWB','徐欢的电脑主机',9,'IN_USE',40,NULL,NULL,NULL,NULL,'2026-08-05 08:35:44.911','2026-09-17 06:39:00.678');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (41,'DT-HPK93X','张燕的电脑主机',1,'IN_USE',41,NULL,NULL,NULL,NULL,'2026-08-05 08:36:18.845','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (42,'DT-VNXYXH','王宇轩',31,'IN_USE',142,NULL,NULL,NULL,NULL,'2026-08-05 08:36:18.930','2026-09-17 08:38:03.776');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (43,'DT-CTDDCW','龙腾云的电脑主机',31,'IN_USE',43,NULL,NULL,NULL,NULL,'2026-08-05 08:36:19.057','2026-09-17 05:55:35.034');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (44,'DT-9NGGUN','唐月的电脑主机',31,'IN_USE',44,NULL,NULL,NULL,NULL,'2026-08-05 08:36:19.144','2026-08-05 08:36:19.144');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (45,'DT-QRTWG9','牛尚尚的电脑主机',31,'IN_USE',45,NULL,NULL,NULL,NULL,'2026-08-05 08:36:19.230','2026-08-05 08:36:19.230');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (46,'DT-6B2CQ2','叼婷婷的电脑主机',31,'IN_USE',46,NULL,NULL,NULL,NULL,'2026-08-05 08:36:19.317','2026-08-05 08:36:19.317');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (47,'DT-TF6PQ2','齐玉婷的电脑主机',31,'IN_USE',47,NULL,NULL,NULL,NULL,'2026-08-05 08:36:19.408','2026-08-05 08:36:19.408');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (48,'DT-V74PNW','徐金洋的电脑主机',33,'IN_USE',48,NULL,NULL,NULL,NULL,'2026-08-05 08:36:23.737','2026-08-05 08:36:23.737');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (49,'DT-F73P75','刘勃瑶的设备',34,'IN_USE',49,NULL,NULL,NULL,NULL,'2026-08-05 08:36:23.887','2026-09-21 05:20:22.190');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (50,'DT-VYUDBX','靳阔的电脑主机',61,'IN_USE',50,NULL,NULL,NULL,NULL,'2026-08-05 08:36:24.055','2026-09-17 06:39:00.700');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (51,'DT-YJ65T4','陈荣荣的电脑主机',61,'IN_USE',51,NULL,NULL,NULL,NULL,'2026-08-05 08:36:24.169','2026-09-17 06:39:00.704');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (52,'DT-38Y29Q','杨美茹的电脑主机',34,'IN_USE',52,NULL,NULL,NULL,NULL,'2026-08-05 08:36:24.253','2026-08-05 08:36:24.253');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (53,'DT-Q4QKFN','闲置',1,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-05 08:36:24.405','2026-09-21 05:18:46.770');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (54,'DT-CBEN62','孟子暄的电脑主机',9,'IN_USE',54,NULL,NULL,NULL,NULL,'2026-08-05 08:36:24.530','2026-09-17 05:55:35.052');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (55,'DT-FCNNVD','左丽杰的电脑主机',34,'IN_USE',55,NULL,NULL,NULL,NULL,'2026-08-05 08:36:29.326','2026-09-17 06:39:00.735');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (56,'DT-EJKAF6','司尚宇的电脑主机',9,'IN_USE',56,NULL,NULL,NULL,NULL,'2026-08-05 08:36:29.389','2026-09-17 06:39:00.679');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (57,'DT-7MVYTV','罗惠芙的电脑主机',9,'IN_USE',57,NULL,NULL,NULL,NULL,'2026-08-05 08:36:29.470','2026-09-17 06:39:00.679');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (58,'DT-CMS7SK','杨程涵的电脑主机',61,'IN_USE',58,NULL,NULL,NULL,NULL,'2026-08-05 08:36:29.581','2026-09-17 06:39:00.704');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (59,'DT-VNS5EZ','田岩艳的电脑主机',9,'IN_USE',59,NULL,NULL,NULL,NULL,'2026-08-05 08:36:29.699','2026-09-17 05:55:35.052');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (60,'DT-2ZYABF','支俊慧的电脑主机',9,'IN_USE',60,NULL,NULL,NULL,NULL,'2026-08-05 08:36:29.743','2026-09-17 06:39:00.679');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (61,'DT-HV8QR8','武冠岐的电脑主机',9,'IN_USE',61,NULL,NULL,NULL,NULL,'2026-08-05 08:36:29.801','2026-09-17 06:39:00.679');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (62,'DT-HC3PGS','王倩的电脑主机',34,'IN_USE',62,NULL,NULL,NULL,NULL,'2026-08-05 08:36:29.881','2026-09-17 05:55:35.032');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (63,'DT-ZNDAXZ','刘柏利的电脑主机',9,'IN_USE',63,NULL,NULL,NULL,NULL,'2026-08-05 08:36:34.791','2026-09-17 06:39:00.681');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (64,'DT-3VHXAK','郭薇的电脑主机',61,'IN_USE',64,NULL,NULL,NULL,NULL,'2026-08-05 08:36:34.948','2026-09-17 06:39:00.700');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (65,'DT-7KFZVK','王书丽的电脑主机',9,'IN_USE',65,NULL,NULL,NULL,NULL,'2026-08-06 02:12:41.581','2026-09-17 06:39:00.678');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (66,'DT-K2DE7P','刘学同的电脑主机',1,'IN_USE',66,NULL,NULL,NULL,NULL,'2026-08-06 02:12:41.645','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (67,'DT-5X9DUN','宋智辉的电脑主机',1,'IN_USE',67,NULL,NULL,NULL,NULL,'2026-08-06 02:12:41.890','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (68,'DT-29VV4D','李一航的电脑主机',1,'IN_USE',68,NULL,NULL,NULL,NULL,'2026-08-06 02:12:41.996','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (69,'DT-4GYAYJ','张令侠的电脑主机',1,'IN_USE',69,NULL,NULL,NULL,NULL,'2026-08-06 02:12:42.103','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (70,'DT-HN2BTW','梁玉彤的电脑主机',61,'IN_USE',70,NULL,NULL,NULL,NULL,'2026-08-06 02:12:42.248','2026-09-17 06:39:00.700');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (71,'DT-5DHUZ7','范晓雨的电脑主机',1,'IN_USE',71,NULL,NULL,NULL,NULL,'2026-08-06 02:12:55.538','2026-09-17 06:39:00.661');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (72,'DT-CY7FDS','杨柳',1,'IN_USE',33,NULL,NULL,NULL,NULL,'2026-08-06 02:12:55.606','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (73,'DT-EQ6P5Q','闲置',9,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-06 02:12:55.751','2026-09-17 06:39:00.678');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (74,'DT-BMC9PJ','姜舒月的电脑主机',1,'IN_USE',74,NULL,NULL,NULL,NULL,'2026-08-06 02:12:55.940','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (75,'DT-976SX6','郭文杰',1,'IN_USE',73,NULL,NULL,NULL,NULL,'2026-08-06 02:12:56.092','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (76,'DT-BBSK4J','刘京的电脑主机',34,'IN_USE',76,NULL,NULL,NULL,NULL,'2026-08-06 02:12:56.178','2026-08-06 02:12:56.178');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (77,'DT-TCDRW5','刘雅的电脑主机',9,'IN_USE',77,NULL,NULL,NULL,NULL,'2026-08-06 02:12:56.311','2026-09-17 06:39:00.678');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (78,'DT-X38GWJ','杨娣',1,'IN_USE',78,NULL,NULL,NULL,NULL,'2026-08-06 02:12:56.460','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (79,'DT-GQ9X6V','闲置',61,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-06 02:12:56.558','2026-09-17 06:39:00.705');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (80,'DT-EN4YFX','于虹玉的电脑主机',34,'IN_USE',80,NULL,NULL,NULL,NULL,'2026-08-06 02:13:00.285','2026-09-17 06:39:00.735');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (81,'DT-NN43WS','田鹤松的主机',31,'IN_USE',81,NULL,NULL,NULL,NULL,'2026-08-06 02:30:05.984','2026-09-17 06:39:00.749');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (82,'DT-9WS2H8','曹靖宇的电脑主机',59,'IN_USE',82,NULL,NULL,NULL,NULL,'2026-08-06 05:44:21.242','2026-08-06 05:44:21.242');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (83,'DT-C9863C','闲置',61,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-06 05:44:24.516','2026-09-17 06:39:00.701');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (84,'DT-D2X2N2','花屏',61,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-06 05:44:27.473','2026-09-11 09:01:28.966');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (85,'DT-UYQ973','李策的电脑主机',61,'IN_USE',85,NULL,NULL,NULL,NULL,'2026-08-06 05:44:30.649','2026-09-17 06:39:00.706');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (86,'DT-SWR7WM','李朔的电脑主机',61,'IN_USE',86,NULL,NULL,NULL,NULL,'2026-08-06 05:44:34.143','2026-09-17 05:55:35.039');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (87,'DT-MH75FJ','孟石梅的电脑主机',61,'IN_USE',87,NULL,NULL,NULL,NULL,'2026-08-06 05:44:37.667','2026-09-17 05:55:35.039');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (88,'DT-6TPGC3','乔欣颖的电脑主机',61,'IN_USE',88,NULL,NULL,NULL,NULL,'2026-08-06 05:44:41.019','2026-09-17 06:39:00.707');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (89,'DT-VBK4FE','宋亚培的电脑主机',66,'IN_USE',89,NULL,NULL,NULL,NULL,'2026-08-06 05:44:44.292','2026-08-06 05:44:44.292');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (90,'DT-57K3HF','王丹的电脑主机',61,'IN_USE',90,NULL,NULL,NULL,NULL,'2026-08-06 05:44:48.019','2026-09-17 05:55:35.039');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (91,'DT-UE32Y7','王佳琦的电脑主机',61,'IN_USE',91,NULL,NULL,NULL,NULL,'2026-08-06 05:44:51.689','2026-09-17 06:39:00.701');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (92,'DT-XAV8PS','徐凯豪的电脑主机',61,'IN_USE',92,NULL,NULL,NULL,NULL,'2026-08-06 05:44:55.748','2026-09-17 06:39:00.702');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (93,'DT-3ZABG7','张紫丹的电脑主机',9,'IN_USE',93,NULL,NULL,NULL,NULL,'2026-08-06 05:45:00.190','2026-09-17 06:39:00.682');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (94,'DT-XY2VY5','赵文丽的电脑主机',9,'IN_USE',94,NULL,NULL,NULL,NULL,'2026-08-06 05:45:03.722','2026-09-17 06:39:00.683');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (95,'DT-M3WNJE','闲置',9,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-06 06:07:27.829','2026-09-17 06:39:00.679');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (96,'DT-XDWDNH','肖旭的电脑主机',73,'IN_USE',96,NULL,NULL,NULL,NULL,'2026-08-06 06:07:32.139','2026-08-06 06:07:32.139');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (97,'DT-TNQ5EX','闲置',9,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-06 06:07:36.094','2026-09-17 06:39:00.679');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (98,'DT-B495ND','陆航的电脑主机',34,'IN_USE',97,NULL,NULL,NULL,NULL,'2026-08-06 08:51:55.265','2026-09-17 06:39:00.736');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (99,'DT-TKTBRV','李洁的电脑主机',1,'IN_USE',98,NULL,NULL,NULL,NULL,'2026-08-06 08:51:55.328','2026-08-06 08:51:55.328');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (100,'DT-STXNTU','申靖淼的电脑主机',1,'IN_USE',99,NULL,NULL,NULL,NULL,'2026-08-06 08:51:55.497','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (101,'DT-MPBMDK','杨淼的电脑主机',76,'IN_USE',100,NULL,NULL,NULL,NULL,'2026-08-06 10:13:45.387','2026-08-06 10:13:45.387');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (102,'DT-B7F5UR','共享的电脑主机',76,'IN_USE',101,NULL,NULL,NULL,NULL,'2026-08-06 10:13:45.517','2026-09-17 06:39:00.768');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (103,'DT-WTE4KX','邬重阳的电脑主机',61,'IN_USE',102,NULL,NULL,NULL,NULL,'2026-08-06 10:13:45.650','2026-09-17 06:39:00.701');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (104,'DT-ZYM3VC','刘婷.的电脑主机',61,'IN_USE',103,NULL,NULL,NULL,NULL,'2026-08-06 10:13:45.725','2026-09-17 05:55:35.039');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (105,'DT-PJ4M9J','张劭轩的电脑主机',61,'IN_USE',104,NULL,NULL,NULL,NULL,'2026-08-06 10:13:45.794','2026-09-17 06:39:00.701');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (106,'DT-KFMF5Y','张佳怡的电脑主机',61,'IN_USE',105,NULL,NULL,NULL,NULL,'2026-08-06 10:13:45.902','2026-09-17 06:39:00.709');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (107,'DT-NHMYKH','郭建华的电脑主机',59,'IN_USE',106,NULL,NULL,NULL,NULL,'2026-08-06 10:13:45.997','2026-09-17 06:39:00.758');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (108,'DT-AST8UN','冯红丽的电脑主机',1,'IN_USE',107,NULL,NULL,NULL,NULL,'2026-08-06 10:13:46.148','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (109,'DT-BU8VS7','勾洋洋的电脑主机',61,'IN_USE',108,NULL,NULL,NULL,NULL,'2026-08-06 10:13:46.291','2026-09-17 06:39:00.700');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (110,'DT-U523FS','刘婷的电脑主机',61,'IN_USE',109,NULL,NULL,NULL,NULL,'2026-08-06 10:13:46.498','2026-09-17 05:55:35.039');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (111,'DT-N9AVRT','高敏的电脑主机',61,'IN_USE',110,NULL,NULL,NULL,NULL,'2026-08-06 10:13:46.621','2026-09-17 06:39:00.710');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (112,'DT-PNC67Y','刘雅婧的电脑主机',34,'IN_USE',111,NULL,NULL,NULL,NULL,'2026-08-07 01:38:48.872','2026-09-17 05:55:35.032');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (113,'DT-AMY88B','尚煜函的电脑主机',1,'IN_USE',112,NULL,NULL,NULL,NULL,'2026-08-07 01:38:49.030','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (114,'DT-67SC99','张瑞同的电脑主机',1,'IN_USE',113,NULL,NULL,NULL,NULL,'2026-08-07 01:38:49.191','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (115,'DT-8KHKTZ','闫欣宇的电脑主机',1,'IN_USE',114,NULL,NULL,NULL,NULL,'2026-08-07 01:38:49.327','2026-09-17 06:39:00.658');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (116,'DT-EWTETG','郭欣欣的电脑主机',9,'IN_USE',115,NULL,NULL,NULL,NULL,'2026-08-07 01:38:49.473','2026-09-17 05:55:35.052');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (117,'DT-8J3DVU','陈爽的电脑主机',91,'IN_USE',116,NULL,NULL,NULL,NULL,'2026-08-07 01:39:02.348','2026-08-07 01:39:02.348');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (172,'DT-CTWF69','齐玉婷的电脑主机',92,'IN_USE',47,NULL,NULL,NULL,NULL,'2026-08-11 03:38:51.082','2026-08-11 03:38:51.082');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (183,'DT-C5C9XP','赵宏颖的电脑主机',61,'IN_USE',117,NULL,NULL,NULL,NULL,'2026-08-11 03:52:21.516','2026-09-17 06:39:00.701');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (184,'DT-4KBF98','相聪的电脑主机',61,'IN_USE',118,NULL,NULL,NULL,NULL,'2026-08-11 03:52:26.141','2026-09-17 06:39:00.701');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (185,'NB-S9AM56','会议室戴尔笔记本',95,'IN_USE',124,NULL,NULL,NULL,NULL,'2026-08-11 05:07:42.335','2026-08-12 02:15:08.508');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (186,'NB-YPX5A6','会议室联想笔记本',96,'IN_USE',125,NULL,NULL,NULL,NULL,'2026-08-11 05:07:54.486','2026-08-12 02:15:20.699');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (187,'DT-7R57BY','空闲1的电脑主机',61,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-11 06:10:50.029','2026-09-17 06:39:00.702');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (188,'DT-F6FQNW','闲置',61,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-08-11 06:10:54.950','2026-09-17 06:39:00.702');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (189,'DT-JA2DEG','李美双的主机',34,'IN_USE',4,NULL,NULL,NULL,NULL,'2026-08-11 06:10:58.230','2026-09-17 05:55:35.032');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (190,'DT-S4YZZF','晋航帆',9,'IN_USE',84,NULL,NULL,NULL,NULL,'2026-08-11 06:11:01.410','2026-09-17 05:55:35.052');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (191,'NB-WPT9HW','程哥电脑',95,'IN_USE',123,NULL,NULL,NULL,NULL,'2026-08-11 06:31:57.097','2026-08-11 06:35:22.550');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (192,'DT-33QBWW','赵颖的电脑主机',34,'IN_USE',126,NULL,NULL,NULL,NULL,'2026-08-13 06:18:41.751','2026-09-17 05:55:35.032');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (193,'DT-Z7Z945','杜晨阳的电脑主机',9,'IN_USE',127,NULL,NULL,NULL,NULL,'2026-08-13 06:18:41.873','2026-09-17 05:55:35.052');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (194,'DT-HUUC4H','刘千慧的电脑主机',9,'IN_USE',128,NULL,NULL,NULL,NULL,'2026-08-13 06:18:41.971','2026-09-17 05:55:35.052');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (195,'DT-SSEBME','韩洪宇的电脑主机',1,'IN_USE',129,NULL,NULL,NULL,NULL,'2026-08-13 06:18:42.100','2026-09-17 05:55:35.055');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (196,'DT-XJZGJW','张钰的电脑主机',61,'IN_USE',130,NULL,NULL,NULL,NULL,'2026-08-13 06:19:34.912','2026-09-17 06:39:00.711');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (198,'DT-FG4Z49','郭启峰',9,'IN_USE',38,NULL,NULL,NULL,NULL,'2026-09-10 07:47:01.143','2026-09-17 06:39:00.678');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (199,'DT-QYQ6BS','闲置',107,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-09-11 08:53:36.687','2026-09-11 08:54:23.540');
INSERT INTO `Asset` (`id`,`assetNo`,`name`,`templateId`,`status`,`employeeId`,`location`,`purchaseDate`,`warrantyMonths`,`notes`,`createdAt`,`updatedAt`) VALUES (200,'DT-NE5XBD','闲置',1,'IDLE',NULL,NULL,NULL,NULL,NULL,'2026-09-11 13:00:03.396','2026-09-17 06:39:00.658');

-- 资产配件 AssetComponent
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (1,1,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (2,1,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (3,1,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (4,1,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (5,1,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (6,1,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (7,2,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (8,2,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (9,2,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (10,2,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (11,2,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (12,2,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (13,3,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (14,3,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (15,3,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (16,3,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (17,3,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (18,3,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (19,4,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (20,4,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (21,4,10,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (22,4,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (23,4,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (24,4,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (25,4,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (26,5,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (27,5,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (28,5,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (29,5,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (30,5,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (31,5,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (32,6,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (33,6,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (34,6,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (35,6,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (36,6,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (37,6,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (38,7,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (39,7,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (40,7,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (41,7,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (42,7,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (43,7,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (44,8,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (45,8,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (46,8,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (47,8,12,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (48,8,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (49,8,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (50,9,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (51,9,14,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (52,9,15,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (53,9,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (54,9,16,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (55,9,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (56,10,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (57,10,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (58,10,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (59,10,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (60,10,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (61,10,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (62,11,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (63,11,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (64,11,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (65,11,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (66,11,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (67,11,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (68,12,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (69,12,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (70,12,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (71,12,18,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (72,12,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (73,12,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (74,13,19,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (75,13,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (76,13,20,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (77,13,21,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (78,13,22,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (79,13,23,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (80,14,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (81,14,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (82,14,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (83,14,18,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (84,14,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (85,14,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (86,15,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (87,15,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (88,15,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (89,15,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (90,15,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (91,15,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (92,16,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (93,16,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (94,16,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (95,16,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (96,16,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (97,16,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (98,17,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (99,17,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (100,17,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (101,17,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (102,17,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (103,17,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (104,18,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (105,18,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (106,18,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (107,18,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (108,18,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (109,18,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (110,19,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (111,19,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (112,19,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (113,19,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (114,19,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (115,19,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (116,20,24,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (117,20,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (118,20,25,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (119,20,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (120,20,26,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (121,20,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (122,21,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (123,21,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (124,21,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (125,21,27,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (126,21,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (127,21,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (128,22,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (129,22,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (130,22,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (131,22,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (132,22,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (133,22,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (134,23,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (135,23,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (136,23,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (137,23,18,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (138,23,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (139,23,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (140,24,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (141,24,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (142,24,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (143,24,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (144,24,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (145,24,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (146,25,28,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (147,25,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (148,25,29,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (149,25,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (150,25,30,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (151,25,31,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (152,26,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (153,26,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (154,26,33,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (155,26,34,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (156,26,35,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (157,26,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (158,27,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (159,27,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (160,27,25,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (161,27,37,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (162,27,38,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (163,27,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (164,28,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (165,28,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (166,28,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (167,28,40,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (168,28,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (169,28,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (170,29,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (171,29,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (172,29,25,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (173,29,41,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (174,29,38,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (175,29,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (176,30,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (177,30,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (178,30,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (179,30,41,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (180,30,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (181,30,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (182,31,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (183,31,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (184,31,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (185,31,42,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (186,31,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (187,31,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (188,32,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (189,32,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (190,32,25,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (191,32,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (192,32,100,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (193,32,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (194,33,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (195,33,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (196,33,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (197,33,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (198,33,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (199,33,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (200,34,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (201,34,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (202,34,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (203,34,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (204,34,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (205,34,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (206,35,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (207,35,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (208,35,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (209,35,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (210,35,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (211,35,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (212,36,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (213,36,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (214,36,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (215,36,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (216,36,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (217,36,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (218,37,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (219,37,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (220,37,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (221,37,44,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (222,37,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (223,37,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (224,38,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (225,38,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (226,38,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (227,38,44,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (228,38,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (229,38,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (230,39,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (231,39,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (232,39,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (233,39,45,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (234,39,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (235,39,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (236,40,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (237,40,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (238,40,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (239,40,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (240,40,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (241,40,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (242,41,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (243,41,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (244,41,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (245,41,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (246,41,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (247,41,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (248,42,46,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (249,42,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (250,42,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (251,42,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (252,42,47,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (253,42,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (254,43,46,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (255,43,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (256,43,48,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (257,43,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (258,43,49,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (259,43,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (260,44,46,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (261,44,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (262,44,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (263,44,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (264,44,47,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (265,44,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (266,45,46,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (267,45,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (268,45,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (269,45,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (270,45,47,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (271,45,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (272,46,46,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (273,46,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (274,46,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (275,46,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (276,46,47,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (277,46,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (278,47,46,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (279,47,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (280,47,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (281,47,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (282,47,47,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (283,47,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (284,48,50,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (285,48,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (286,48,51,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (287,48,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (288,48,52,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (289,48,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (290,49,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (291,49,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (292,49,53,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (293,49,51,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (294,49,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (295,49,38,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (296,49,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (297,50,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (298,50,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (299,50,15,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (300,50,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (301,50,55,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (302,50,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (303,51,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (304,51,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (305,51,56,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (306,51,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (307,51,35,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (308,51,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (309,52,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (310,52,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (311,52,53,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (312,52,51,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (313,52,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (314,52,38,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (315,52,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (316,53,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (317,53,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (318,53,53,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (319,53,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (320,53,57,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (321,53,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (322,53,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (323,54,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (324,54,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (325,54,53,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (326,54,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (327,54,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (328,54,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (329,54,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (330,55,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (331,55,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (332,55,58,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (333,55,59,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (334,55,38,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (335,55,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (336,56,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (337,56,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (338,56,58,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (339,56,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (340,56,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (341,56,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (342,57,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (343,57,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (344,57,58,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (345,57,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (346,57,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (347,57,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (348,58,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (349,58,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (350,58,58,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (351,58,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (352,58,35,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (353,58,31,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (354,59,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (355,59,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (356,59,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (357,59,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (358,59,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (359,59,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (360,60,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (361,60,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (362,60,58,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (363,60,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (364,60,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (365,60,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (366,61,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (367,61,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (368,61,58,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (369,61,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (370,61,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (371,61,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (372,62,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (373,62,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (374,62,51,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (375,62,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (376,62,100,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (377,62,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (378,63,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (379,63,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (380,63,62,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (381,63,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (382,63,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (383,63,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (384,63,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (385,64,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (386,64,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (387,64,15,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (388,64,63,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (389,64,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (390,64,65,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (391,65,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (392,65,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (393,65,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (394,65,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (395,65,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (396,65,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (397,66,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (398,66,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (399,66,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (400,66,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (401,66,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (402,66,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (403,67,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (404,67,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (405,67,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (406,67,66,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (407,67,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (408,67,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (409,68,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (410,68,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (411,68,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (412,68,12,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (413,68,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (414,68,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (415,69,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (416,69,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (417,69,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (418,69,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (419,69,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (420,69,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (421,70,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (422,70,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (423,70,15,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (424,70,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (425,70,67,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (426,70,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (427,71,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (428,71,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (429,71,68,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (430,71,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (431,71,69,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (432,71,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (433,72,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (434,72,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (435,72,53,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (436,72,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (437,72,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (438,72,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (439,72,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (440,73,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (441,73,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (442,73,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (443,73,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (444,73,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (445,73,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (446,74,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (447,74,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (448,74,53,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (449,74,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (450,74,41,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (451,74,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (452,74,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (453,75,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (454,75,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (455,75,53,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (456,75,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (457,75,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (458,75,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (459,75,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (460,76,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (461,76,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (462,76,53,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (463,76,51,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (464,76,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (465,76,38,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (466,76,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (467,77,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (468,77,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (469,77,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (470,77,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (471,77,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (472,77,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (473,78,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (474,78,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (475,78,53,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (476,78,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (477,78,44,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (478,78,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (479,78,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (480,79,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (481,79,7,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (482,79,62,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (483,79,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (484,79,70,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (485,79,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (486,80,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (487,80,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (488,80,25,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (489,80,12,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (490,80,100,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (491,80,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (492,81,46,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (493,81,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (494,81,71,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (495,81,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (496,81,72,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (497,81,73,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (498,82,74,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (499,82,14,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (500,82,56,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (501,82,75,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (502,82,76,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (503,82,77,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (504,82,78,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (505,83,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (506,83,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (507,83,15,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (508,83,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (509,83,55,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (510,83,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (511,84,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (512,84,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (513,84,79,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (514,84,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (515,84,80,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (516,84,81,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (517,85,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (518,85,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (519,85,15,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (520,85,33,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (521,85,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (522,85,35,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (523,85,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (524,86,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (525,86,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (526,86,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (527,86,83,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (528,86,35,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (529,86,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (530,87,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (531,87,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (532,87,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (533,87,84,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (534,87,70,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (535,87,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (536,88,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (537,88,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (538,88,85,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (539,88,86,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (540,88,44,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (541,88,87,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (542,88,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (543,89,88,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (544,89,14,4);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (545,89,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (546,89,89,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (547,89,75,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (548,89,84,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (549,89,77,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (550,89,78,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (551,90,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (552,90,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (553,90,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (554,90,65,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (555,90,55,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (556,90,31,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (557,91,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (558,91,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (559,91,33,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (560,91,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (561,91,35,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (562,91,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (563,92,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (564,92,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (565,92,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (566,92,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (567,92,55,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (568,92,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (569,93,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (570,93,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (571,93,91,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (572,93,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (573,93,92,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (574,93,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (575,94,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (576,94,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (577,94,15,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (578,94,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (579,94,80,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (580,94,31,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (581,95,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (582,95,14,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (583,95,91,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (584,95,93,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (585,95,92,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (586,95,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (587,96,94,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (588,96,95,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (589,96,51,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (590,96,12,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (591,96,96,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (592,97,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (593,97,14,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (594,97,91,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (595,97,93,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (596,97,92,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (597,97,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (598,98,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (599,98,106,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (600,98,99,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (601,98,51,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (602,98,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (603,98,100,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (604,98,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (605,99,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (606,99,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (607,99,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (608,99,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (609,99,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (610,99,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (611,100,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (612,100,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (613,100,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (614,100,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (615,100,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (616,100,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (617,101,101,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (618,101,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (619,101,102,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (620,101,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (621,101,103,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (622,101,81,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (623,102,101,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (624,102,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (625,102,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (626,102,104,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (627,102,103,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (628,102,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (629,103,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (630,103,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (631,103,33,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (632,103,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (633,103,55,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (634,103,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (635,104,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (636,104,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (637,104,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (638,104,35,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (639,104,81,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (640,105,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (641,105,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (642,105,33,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (643,105,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (644,105,35,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (645,105,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (646,106,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (647,106,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (648,106,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (649,106,45,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (650,106,70,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (651,106,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (652,107,74,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (653,107,14,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (654,107,7,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (655,107,29,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (656,107,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (657,107,105,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (658,107,78,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (659,108,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (660,108,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (661,108,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (662,108,40,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (663,108,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (664,108,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (665,109,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (666,109,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (667,109,15,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (668,109,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (669,109,55,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (670,109,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (671,110,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (672,110,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (673,110,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (674,110,44,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (675,110,70,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (676,110,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (677,111,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (678,111,7,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (679,111,15,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (680,111,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (681,111,35,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (682,111,81,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (683,112,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (684,112,106,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (685,112,51,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (686,112,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (687,112,100,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (688,112,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (689,113,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (690,113,106,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (691,113,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (692,113,108,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (693,113,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (694,113,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (695,114,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (696,114,106,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (697,114,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (698,114,12,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (699,114,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (700,114,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (701,115,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (702,115,109,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (703,115,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (704,115,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (705,115,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (706,115,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (707,116,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (708,116,109,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (709,116,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (710,116,18,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (711,116,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (712,116,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (713,117,111,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (714,117,112,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (715,117,113,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (716,117,83,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (717,117,114,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (718,117,6,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (725,183,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (726,183,115,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (727,183,15,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (728,183,18,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (729,183,67,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (730,183,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (731,184,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (732,184,115,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (733,184,15,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (734,184,11,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (735,184,67,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (736,184,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (737,187,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (738,187,116,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (739,187,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (740,187,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (741,187,55,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (742,187,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (743,188,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (744,188,116,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (745,188,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (746,188,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (747,188,55,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (748,188,81,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (749,189,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (750,189,106,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (751,189,51,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (752,189,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (753,189,100,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (754,189,81,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (755,190,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (756,190,109,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (757,190,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (758,190,8,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (759,190,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (760,190,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (761,192,36,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (762,192,2,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (763,192,51,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (764,192,118,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (765,192,119,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (766,192,39,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (767,193,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (768,193,115,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (769,193,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (770,193,12,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (771,193,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (772,193,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (773,194,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (774,194,109,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (775,194,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (776,194,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (777,194,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (778,194,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (779,195,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (780,195,106,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (781,195,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (782,195,60,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (783,195,5,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (784,195,81,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (785,196,32,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (786,196,116,3);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (787,196,82,2);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (788,196,56,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (789,196,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (790,196,55,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (791,196,17,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (798,198,13,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (799,198,106,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (800,198,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (801,198,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (802,198,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (803,198,81,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (804,1,123,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (805,199,128,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (806,199,116,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (807,199,82,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (808,199,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (809,199,55,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (810,199,81,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (811,200,1,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (812,200,109,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (813,200,3,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (814,200,54,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (815,200,9,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (816,200,81,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (823,64,123,1);
INSERT INTO `AssetComponent` (`id`,`assetId`,`modelId`,`quantity`) VALUES (824,42,129,1);

-- 生命周期日志 LifecycleLog（operatorId/requestId 留空）
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (1,1,'ALLOCATED','IDLE','IN_USE',1,NULL,'system','自动导入分配给 刘源','2026-08-05 08:35:19.360');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (2,2,'ALLOCATED','IDLE','IN_USE',2,NULL,'system','自动导入分配给 张艳茹','2026-08-05 08:35:19.441');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (3,3,'ALLOCATED','IDLE','IN_USE',3,NULL,'system','自动导入分配给 李佳','2026-08-05 08:35:19.535');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (4,4,'ALLOCATED','IDLE','IN_USE',4,NULL,'system','自动导入分配给 李美双','2026-08-05 08:35:19.662');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (5,5,'ALLOCATED','IDLE','IN_USE',5,NULL,'system','自动导入分配给 赵闯','2026-08-05 08:35:24.183');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (6,6,'ALLOCATED','IDLE','IN_USE',6,NULL,'system','自动导入分配给 秦梓涵','2026-08-05 08:35:24.285');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (7,7,'ALLOCATED','IDLE','IN_USE',7,NULL,'system','自动导入分配给 李一娜','2026-08-05 08:35:24.382');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (8,8,'ALLOCATED','IDLE','IN_USE',8,NULL,'system','自动导入分配给 周丽','2026-08-05 08:35:24.519');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (9,9,'ALLOCATED','IDLE','IN_USE',9,NULL,'system','自动导入分配给 宋恬','2026-08-05 08:35:24.660');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (10,10,'ALLOCATED','IDLE','IN_USE',10,NULL,'system','自动导入分配给 张良爽','2026-08-05 08:35:24.705');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (11,11,'ALLOCATED','IDLE','IN_USE',11,NULL,'system','自动导入分配给 袁雯珊','2026-08-05 08:35:24.760');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (12,12,'ALLOCATED','IDLE','IN_USE',12,NULL,'system','自动导入分配给 魏栩莹','2026-08-05 08:35:24.943');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (13,13,'ALLOCATED','IDLE','IN_USE',13,NULL,'system','自动导入分配给 韩晓林','2026-08-05 08:35:25.104');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (14,14,'ALLOCATED','IDLE','IN_USE',14,NULL,'system','自动导入分配给 王璐瑀','2026-08-05 08:35:25.225');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (15,15,'ALLOCATED','IDLE','IN_USE',15,NULL,'system','自动导入分配给 陈凯月','2026-08-05 08:35:25.322');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (16,16,'ALLOCATED','IDLE','IN_USE',16,NULL,'system','自动导入分配给 王畅','2026-08-05 08:35:25.418');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (17,17,'ALLOCATED','IDLE','IN_USE',17,NULL,'system','自动导入分配给 王艳华','2026-08-05 08:35:25.526');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (18,18,'ALLOCATED','IDLE','IN_USE',18,NULL,'system','自动导入分配给 乔雪坤','2026-08-05 08:35:25.638');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (19,19,'ALLOCATED','IDLE','IN_USE',19,NULL,'system','自动导入分配给 黑德凯','2026-08-05 08:35:25.736');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (20,20,'ALLOCATED','IDLE','IN_USE',20,NULL,'system','自动导入分配给 徐佳红','2026-08-05 08:35:25.880');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (21,21,'ALLOCATED','IDLE','IN_USE',21,NULL,'system','自动导入分配给 王星戈','2026-08-05 08:35:26.047');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (22,22,'ALLOCATED','IDLE','IN_USE',22,NULL,'system','自动导入分配给 宫庆芳','2026-08-05 08:35:26.149');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (23,23,'ALLOCATED','IDLE','IN_USE',23,NULL,'system','自动导入分配给 代城昊','2026-08-05 08:35:26.206');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (24,24,'ALLOCATED','IDLE','IN_USE',24,NULL,'system','自动导入分配给 高海兰','2026-08-05 08:35:26.272');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (25,25,'ALLOCATED','IDLE','IN_USE',25,NULL,'system','自动导入分配给 祖国庆','2026-08-05 08:35:36.109');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (26,26,'ALLOCATED','IDLE','IN_USE',26,NULL,'system','自动导入分配给 刘美宁','2026-08-05 08:35:36.218');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (27,27,'ALLOCATED','IDLE','IN_USE',27,NULL,'system','自动导入分配给 王镜淇','2026-08-05 08:35:36.353');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (28,28,'ALLOCATED','IDLE','IN_USE',28,NULL,'system','自动导入分配给 刘航','2026-08-05 08:35:36.471');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (29,29,'ALLOCATED','IDLE','IN_USE',29,NULL,'system','自动导入分配给 任雅瑞','2026-08-05 08:35:36.560');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (30,30,'ALLOCATED','IDLE','IN_USE',30,NULL,'system','自动导入分配给 赵鹏瑾','2026-08-05 08:35:36.603');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (31,31,'ALLOCATED','IDLE','IN_USE',31,NULL,'system','自动导入分配给 韩熹晨','2026-08-05 08:35:36.665');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (32,32,'ALLOCATED','IDLE','IN_USE',32,NULL,'system','自动导入分配给 李怡庆','2026-08-05 08:35:43.711');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (33,33,'ALLOCATED','IDLE','IN_USE',33,NULL,'system','自动导入分配给 杨柳','2026-08-05 08:35:43.928');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (34,34,'ALLOCATED','IDLE','IN_USE',34,NULL,'system','自动导入分配给 梁子丹','2026-08-05 08:35:44.127');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (35,35,'ALLOCATED','IDLE','IN_USE',35,NULL,'system','自动导入分配给 张依','2026-08-05 08:35:44.263');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (36,36,'ALLOCATED','IDLE','IN_USE',36,NULL,'system','自动导入分配给 倪紫韵','2026-08-05 08:35:44.390');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (37,37,'ALLOCATED','IDLE','IN_USE',37,NULL,'system','自动导入分配给 郑永蔷','2026-08-05 08:35:44.537');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (38,38,'ALLOCATED','IDLE','IN_USE',38,NULL,'system','自动导入分配给 李禹澎','2026-08-05 08:35:44.649');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (39,39,'ALLOCATED','IDLE','IN_USE',39,NULL,'system','自动导入分配给 袁永超','2026-08-05 08:35:44.775');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (40,40,'ALLOCATED','IDLE','IN_USE',40,NULL,'system','自动导入分配给 徐欢','2026-08-05 08:35:44.918');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (41,41,'ALLOCATED','IDLE','IN_USE',41,NULL,'system','自动导入分配给 张燕','2026-08-05 08:36:18.847');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (42,42,'ALLOCATED','IDLE','IN_USE',42,NULL,'system','自动导入分配给 备用机','2026-08-05 08:36:18.934');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (43,43,'ALLOCATED','IDLE','IN_USE',43,NULL,'system','自动导入分配给 龙腾云','2026-08-05 08:36:19.064');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (44,44,'ALLOCATED','IDLE','IN_USE',44,NULL,'system','自动导入分配给 唐月','2026-08-05 08:36:19.151');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (45,45,'ALLOCATED','IDLE','IN_USE',45,NULL,'system','自动导入分配给 牛尚尚','2026-08-05 08:36:19.237');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (46,46,'ALLOCATED','IDLE','IN_USE',46,NULL,'system','自动导入分配给 叼婷婷','2026-08-05 08:36:19.324');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (47,47,'ALLOCATED','IDLE','IN_USE',47,NULL,'system','自动导入分配给 齐玉婷','2026-08-05 08:36:19.417');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (48,48,'ALLOCATED','IDLE','IN_USE',48,NULL,'system','自动导入分配给 徐金洋','2026-08-05 08:36:23.740');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (49,49,'ALLOCATED','IDLE','IN_USE',49,NULL,'system','自动导入分配给 王婉芯','2026-08-05 08:36:23.917');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (50,50,'ALLOCATED','IDLE','IN_USE',50,NULL,'system','自动导入分配给 靳阔','2026-08-05 08:36:24.062');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (51,51,'ALLOCATED','IDLE','IN_USE',51,NULL,'system','自动导入分配给 陈荣荣','2026-08-05 08:36:24.173');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (52,52,'ALLOCATED','IDLE','IN_USE',52,NULL,'system','自动导入分配给 杨美茹','2026-08-05 08:36:24.261');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (53,53,'ALLOCATED','IDLE','IN_USE',53,NULL,'system','自动导入分配给 卞雲吉','2026-08-05 08:36:24.413');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (54,54,'ALLOCATED','IDLE','IN_USE',54,NULL,'system','自动导入分配给 孟子暄','2026-08-05 08:36:24.537');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (55,55,'ALLOCATED','IDLE','IN_USE',55,NULL,'system','自动导入分配给 左丽杰','2026-08-05 08:36:29.329');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (56,56,'ALLOCATED','IDLE','IN_USE',56,NULL,'system','自动导入分配给 司尚宇','2026-08-05 08:36:29.393');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (57,57,'ALLOCATED','IDLE','IN_USE',57,NULL,'system','自动导入分配给 罗惠芙','2026-08-05 08:36:29.478');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (58,58,'ALLOCATED','IDLE','IN_USE',58,NULL,'system','自动导入分配给 杨程涵','2026-08-05 08:36:29.588');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (59,59,'ALLOCATED','IDLE','IN_USE',59,NULL,'system','自动导入分配给 田岩艳','2026-08-05 08:36:29.702');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (60,60,'ALLOCATED','IDLE','IN_USE',60,NULL,'system','自动导入分配给 支俊慧','2026-08-05 08:36:29.747');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (61,61,'ALLOCATED','IDLE','IN_USE',61,NULL,'system','自动导入分配给 武冠岐','2026-08-05 08:36:29.805');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (62,62,'ALLOCATED','IDLE','IN_USE',62,NULL,'system','自动导入分配给 王倩','2026-08-05 08:36:29.944');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (63,63,'ALLOCATED','IDLE','IN_USE',63,NULL,'system','自动导入分配给 刘柏利','2026-08-05 08:36:34.800');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (64,64,'ALLOCATED','IDLE','IN_USE',64,NULL,'system','自动导入分配给 郭薇','2026-08-05 08:36:34.955');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (65,65,'ALLOCATED','IDLE','IN_USE',65,NULL,'system','自动导入分配给 王书丽','2026-08-06 02:12:41.585');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (66,66,'ALLOCATED','IDLE','IN_USE',66,NULL,'system','自动导入分配给 刘学同','2026-08-06 02:12:41.697');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (67,67,'ALLOCATED','IDLE','IN_USE',67,NULL,'system','自动导入分配给 宋智辉','2026-08-06 02:12:41.898');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (68,68,'ALLOCATED','IDLE','IN_USE',68,NULL,'system','自动导入分配给 李一航','2026-08-06 02:12:42.004');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (69,69,'ALLOCATED','IDLE','IN_USE',69,NULL,'system','自动导入分配给 张令侠','2026-08-06 02:12:42.111');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (70,70,'ALLOCATED','IDLE','IN_USE',70,NULL,'system','自动导入分配给 梁玉彤','2026-08-06 02:12:42.254');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (71,71,'ALLOCATED','IDLE','IN_USE',71,NULL,'system','自动导入分配给 范晓雨','2026-08-06 02:12:55.540');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (72,72,'ALLOCATED','IDLE','IN_USE',72,NULL,'system','自动导入分配给 姜姝含','2026-08-06 02:12:55.609');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (73,73,'ALLOCATED','IDLE','IN_USE',73,NULL,'system','自动导入分配给 郭文杰','2026-08-06 02:12:55.774');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (74,74,'ALLOCATED','IDLE','IN_USE',74,NULL,'system','自动导入分配给 姜舒月','2026-08-06 02:12:55.948');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (75,75,'ALLOCATED','IDLE','IN_USE',75,NULL,'system','自动导入分配给 刘勃瑶','2026-08-06 02:12:56.100');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (76,76,'ALLOCATED','IDLE','IN_USE',76,NULL,'system','自动导入分配给 刘京','2026-08-06 02:12:56.186');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (77,77,'ALLOCATED','IDLE','IN_USE',77,NULL,'system','自动导入分配给 刘雅','2026-08-06 02:12:56.317');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (78,78,'ALLOCATED','IDLE','IN_USE',78,NULL,'system','自动导入分配给 卢琦','2026-08-06 02:12:56.468');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (79,79,'ALLOCATED','IDLE','IN_USE',79,NULL,'system','自动导入分配给 王培畅','2026-08-06 02:12:56.561');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (80,80,'ALLOCATED','IDLE','IN_USE',80,NULL,'system','自动导入分配给 于虹玉','2026-08-06 02:13:00.288');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (81,81,'ALLOCATED','IDLE','IN_USE',81,NULL,'system','自动导入分配给 田鹤松','2026-08-06 02:30:05.987');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (82,82,'ALLOCATED','IDLE','IN_USE',82,NULL,'system','自动导入分配给 曹靖宇','2026-08-06 05:44:21.245');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (83,83,'ALLOCATED','IDLE','IN_USE',83,NULL,'system','自动导入分配给 服务器旁','2026-08-06 05:44:24.519');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (84,84,'ALLOCATED','IDLE','IN_USE',84,NULL,'system','自动导入分配给 晋航帆','2026-08-06 05:44:27.475');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (85,85,'ALLOCATED','IDLE','IN_USE',85,NULL,'system','自动导入分配给 李策','2026-08-06 05:44:30.651');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (86,86,'ALLOCATED','IDLE','IN_USE',86,NULL,'system','自动导入分配给 李朔','2026-08-06 05:44:34.147');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (87,87,'ALLOCATED','IDLE','IN_USE',87,NULL,'system','自动导入分配给 孟石梅','2026-08-06 05:44:37.669');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (88,88,'ALLOCATED','IDLE','IN_USE',88,NULL,'system','自动导入分配给 乔欣颖','2026-08-06 05:44:41.022');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (89,89,'ALLOCATED','IDLE','IN_USE',89,NULL,'system','自动导入分配给 宋亚培','2026-08-06 05:44:44.295');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (90,90,'ALLOCATED','IDLE','IN_USE',90,NULL,'system','自动导入分配给 王丹','2026-08-06 05:44:48.021');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (91,91,'ALLOCATED','IDLE','IN_USE',91,NULL,'system','自动导入分配给 王佳琦','2026-08-06 05:44:51.691');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (92,92,'ALLOCATED','IDLE','IN_USE',92,NULL,'system','自动导入分配给 徐凯豪','2026-08-06 05:44:55.751');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (93,93,'ALLOCATED','IDLE','IN_USE',93,NULL,'system','自动导入分配给 张紫丹','2026-08-06 05:45:00.194');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (94,94,'ALLOCATED','IDLE','IN_USE',94,NULL,'system','自动导入分配给 赵文丽','2026-08-06 05:45:03.725');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (95,95,'ALLOCATED','IDLE','IN_USE',95,NULL,'system','自动导入分配给 闲置1','2026-08-06 06:07:27.832');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (96,96,'ALLOCATED','IDLE','IN_USE',96,NULL,'system','自动导入分配给 肖旭','2026-08-06 06:07:32.141');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (97,97,'ALLOCATED','IDLE','IN_USE',95,NULL,'system','自动导入分配给 闲置1','2026-08-06 06:07:36.097');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (98,98,'ALLOCATED','IDLE','IN_USE',97,NULL,'system','自动导入分配给 陆航','2026-08-06 08:51:55.268');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (99,99,'ALLOCATED','IDLE','IN_USE',98,NULL,'system','自动导入分配给 李洁','2026-08-06 08:51:55.334');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (100,100,'ALLOCATED','IDLE','IN_USE',99,NULL,'system','自动导入分配给 申靖淼','2026-08-06 08:51:55.505');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (101,101,'ALLOCATED','IDLE','IN_USE',100,NULL,'system','自动导入分配给 杨淼','2026-08-06 10:13:45.390');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (102,102,'ALLOCATED','IDLE','IN_USE',101,NULL,'system','自动导入分配给 共享','2026-08-06 10:13:45.524');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (103,103,'ALLOCATED','IDLE','IN_USE',102,NULL,'system','自动导入分配给 邬重阳','2026-08-06 10:13:45.658');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (104,104,'ALLOCATED','IDLE','IN_USE',103,NULL,'system','自动导入分配给 刘婷.','2026-08-06 10:13:45.728');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (105,105,'ALLOCATED','IDLE','IN_USE',104,NULL,'system','自动导入分配给 张劭轩','2026-08-06 10:13:45.801');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (106,106,'ALLOCATED','IDLE','IN_USE',105,NULL,'system','自动导入分配给 张佳怡','2026-08-06 10:13:45.907');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (107,107,'ALLOCATED','IDLE','IN_USE',106,NULL,'system','自动导入分配给 郭建华','2026-08-06 10:13:46.002');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (108,108,'ALLOCATED','IDLE','IN_USE',107,NULL,'system','自动导入分配给 冯红丽','2026-08-06 10:13:46.164');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (109,109,'ALLOCATED','IDLE','IN_USE',108,NULL,'system','自动导入分配给 勾洋洋','2026-08-06 10:13:46.327');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (110,110,'ALLOCATED','IDLE','IN_USE',109,NULL,'system','自动导入分配给 刘婷','2026-08-06 10:13:46.503');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (111,111,'ALLOCATED','IDLE','IN_USE',110,NULL,'system','自动导入分配给 高敏','2026-08-06 10:13:46.628');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (112,112,'ALLOCATED','IDLE','IN_USE',111,NULL,'system','自动导入分配给 刘雅婧','2026-08-07 01:38:48.875');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (113,113,'ALLOCATED','IDLE','IN_USE',112,NULL,'system','自动导入分配给 尚煜函','2026-08-07 01:38:49.036');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (114,114,'ALLOCATED','IDLE','IN_USE',113,NULL,'system','自动导入分配给 张瑞同','2026-08-07 01:38:49.196');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (115,115,'ALLOCATED','IDLE','IN_USE',114,NULL,'system','自动导入分配给 闫欣宇','2026-08-07 01:38:49.335');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (116,116,'ALLOCATED','IDLE','IN_USE',115,NULL,'system','自动导入分配给 郭欣欣','2026-08-07 01:38:49.480');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (117,117,'ALLOCATED','IDLE','IN_USE',116,NULL,'system','自动导入分配给 陈爽','2026-08-07 01:39:02.350');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (118,117,'UPGRADED','IN_USE','IN_USE',NULL,NULL,'admin','配置调整：-1 16GB DDR2666MHz','2026-08-07 01:39:50.668');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (173,172,'ALLOCATED','IDLE','IN_USE',47,NULL,'system','自动导入分配给 齐玉婷','2026-08-11 03:38:51.087');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (184,183,'ALLOCATED','IDLE','IN_USE',117,NULL,'system','自动导入分配给 赵宏颖','2026-08-11 03:52:21.519');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (185,184,'ALLOCATED','IDLE','IN_USE',118,NULL,'system','自动导入分配给 相聪','2026-08-11 03:52:26.144');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (186,185,'CREATED',NULL,'IDLE',NULL,NULL,'admin','按模板 戴尔笔记本 生成','2026-08-11 05:07:42.337');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (187,186,'CREATED',NULL,'IDLE',NULL,NULL,'admin','按模板 联想笔记本 生成','2026-08-11 05:07:54.488');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (188,187,'ALLOCATED','IDLE','IN_USE',119,NULL,'system','自动导入分配给 空闲1','2026-08-11 06:10:50.032');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (189,188,'ALLOCATED','IDLE','IN_USE',120,NULL,'system','自动导入分配给 空闲2','2026-08-11 06:10:54.952');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (190,189,'ALLOCATED','IDLE','IN_USE',121,NULL,'system','自动导入分配给 空闲3','2026-08-11 06:10:58.233');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (191,190,'ALLOCATED','IDLE','IN_USE',122,NULL,'system','自动导入分配给 空闲4','2026-08-11 06:11:01.413');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (192,187,'RETURNED','IN_USE','IDLE',119,NULL,'admin','批量归还','2026-08-11 06:13:29.666');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (193,188,'RETURNED','IN_USE','IDLE',120,NULL,'admin','批量归还','2026-08-11 06:13:29.666');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (194,189,'RETURNED','IN_USE','IDLE',121,NULL,'admin','批量归还','2026-08-11 06:13:29.666');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (195,190,'RETURNED','IN_USE','IDLE',122,NULL,'admin','批量归还','2026-08-11 06:13:29.666');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (196,4,'RETURNED','IN_USE','IDLE',4,NULL,'admin','列表快捷归还','2026-08-11 06:13:44.243');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (197,189,'ALLOCATED','IDLE','IN_USE',4,NULL,'admin','列表快捷分配','2026-08-11 06:13:57.593');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (198,191,'CREATED',NULL,'IDLE',NULL,NULL,'admin','按模板 戴尔笔记本 生成','2026-08-11 06:31:57.099');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (199,191,'ALLOCATED','IDLE','IN_USE',123,NULL,'admin','列表快捷分配','2026-08-11 06:35:22.555');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (200,185,'ALLOCATED','IDLE','IN_USE',124,NULL,'admin','列表快捷分配','2026-08-12 02:15:08.512');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (201,186,'ALLOCATED','IDLE','IN_USE',125,NULL,'admin','列表快捷分配','2026-08-12 02:15:20.702');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (202,192,'ALLOCATED','IDLE','IN_USE',126,NULL,'system','自动导入分配给 赵颖','2026-08-13 06:18:41.755');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (203,193,'ALLOCATED','IDLE','IN_USE',127,NULL,'system','自动导入分配给 杜晨阳','2026-08-13 06:18:41.876');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (204,194,'ALLOCATED','IDLE','IN_USE',128,NULL,'system','自动导入分配给 刘千慧','2026-08-13 06:18:41.975');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (205,195,'ALLOCATED','IDLE','IN_USE',129,NULL,'system','自动导入分配给 韩洪宇','2026-08-13 06:18:42.105');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (206,196,'ALLOCATED','IDLE','IN_USE',130,NULL,'system','自动导入分配给 张钰','2026-08-13 06:19:34.915');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (207,84,'RETURNED','IN_USE','IDLE',84,NULL,'admin','列表快捷归还','2026-08-21 01:43:48.219');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (208,190,'ALLOCATED','IDLE','IN_USE',84,NULL,'admin','列表快捷分配','2026-08-21 01:44:32.322');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (209,84,'MAINTENANCE_START','IDLE','IN_MAINTENANCE',NULL,NULL,'admin',NULL,'2026-08-21 01:44:54.738');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (210,4,'ALLOCATED','IDLE','IN_USE',131,NULL,'admin','列表快捷分配','2026-08-31 01:17:23.603');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (211,95,'RETURNED','IN_USE','IDLE',95,NULL,'admin','列表快捷归还','2026-09-10 06:20:23.966');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (212,97,'RETURNED','IN_USE','IDLE',95,NULL,'admin','列表快捷归还','2026-09-10 06:26:45.070');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (215,198,'ALLOCATED','IDLE','IN_USE',132,NULL,'system','自动导入分配给 1','2026-09-10 07:47:01.146');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (216,198,'RETURNED','IN_USE','IDLE',132,NULL,'admin','列表快捷归还','2026-09-10 07:47:43.240');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (217,38,'RETURNED','IN_USE','IDLE',38,NULL,'admin','列表快捷归还','2026-09-11 04:21:40.789');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (218,198,'ALLOCATED','IDLE','IN_USE',38,NULL,'admin','列表快捷分配','2026-09-11 04:22:21.769');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (219,1,'UPGRADED','IN_USE','IN_USE',NULL,NULL,'admin','配置调整：+1 双飞燕键盘','2026-09-11 04:27:36.850');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (220,73,'RETURNED','IN_USE','IDLE',73,NULL,'admin','列表快捷归还','2026-09-11 07:09:18.502');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (221,199,'ALLOCATED','IDLE','IN_USE',133,NULL,'system','自动导入分配给 12','2026-09-11 08:53:36.689');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (222,199,'RETURNED','IN_USE','IDLE',133,NULL,'admin','列表快捷归还','2026-09-11 08:54:23.541');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (223,84,'MAINTENANCE_DONE','IN_MAINTENANCE','IDLE',NULL,NULL,'admin',NULL,'2026-09-11 09:01:28.968');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (224,83,'RETURNED','IN_USE','IDLE',83,NULL,'admin','列表快捷归还','2026-09-11 12:21:58.499');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (225,72,'RETURNED','IN_USE','IDLE',72,NULL,'admin','列表快捷归还','2026-09-11 12:39:18.552');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (226,200,'ALLOCATED','IDLE','IN_USE',133,NULL,'system','自动导入分配给 12','2026-09-11 13:00:03.400');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (228,200,'RETURNED','IN_USE','IDLE',133,NULL,'admin','列表快捷归还','2026-09-11 13:00:53.313');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (229,188,'ALLOCATED','IDLE','IN_USE',134,NULL,'admin','列表快捷分配','2026-09-15 01:52:35.714');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (230,188,'RETURNED','IN_USE','IDLE',134,NULL,'admin','列表快捷归还','2026-09-15 01:52:58.192');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (231,33,'RETURNED','IN_USE','IDLE',33,NULL,'admin','列表快捷归还','2026-09-15 02:22:47.627');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (232,72,'ALLOCATED','IDLE','IN_USE',33,NULL,'admin','列表快捷分配','2026-09-15 02:23:11.038');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (233,79,'RETURNED','IN_USE','IDLE',79,NULL,'admin','列表快捷归还','2026-09-15 03:33:06.465');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (234,78,'RETURNED','IN_USE','IDLE',78,NULL,'admin','列表快捷归还','2026-09-15 03:35:01.864');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (235,78,'ALLOCATED','IDLE','IN_USE',78,NULL,'admin','列表快捷分配','2026-09-15 03:35:24.698');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (236,75,'RETURNED','IN_USE','IDLE',75,NULL,'admin','列表快捷归还','2026-09-15 03:39:34.183');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (237,75,'ALLOCATED','IDLE','IN_USE',73,NULL,'admin','列表快捷分配','2026-09-15 03:39:52.358');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (238,64,'UPGRADED','IN_USE','IN_USE',NULL,NULL,'admin','配置调整：+1 双飞燕键盘','2026-09-15 04:19:40.203');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (239,42,'RETURNED','IN_USE','IDLE',42,NULL,'admin','列表快捷归还','2026-09-17 08:36:47.268');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (240,42,'ALLOCATED','IDLE','IN_USE',142,NULL,'admin','列表快捷分配','2026-09-17 08:38:03.781');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (241,42,'UPGRADED','IN_USE','IN_USE',NULL,NULL,'admin','配置调整：+1 飞利浦鼠标','2026-09-17 08:42:08.746');
INSERT INTO `LifecycleLog` (`id`,`assetId`,`action`,`fromStatus`,`toStatus`,`employeeId`,`fromEmployeeId`,`operator`,`remark`,`createdAt`) VALUES (242,53,'RETURNED','IN_USE','IDLE',53,NULL,'admin','列表快捷归还','2026-09-21 05:18:46.819');

-- 盘点会话 StocktakeSession
INSERT INTO `StocktakeSession` (`id`,`name`,`description`,`status`,`startedAt`,`completedAt`) VALUES (1,'8月盘点',NULL,'OPEN','2026-08-06 07:58:12.815',NULL);

-- 盘点明细 StocktakeRecord
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (1,1,1,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (2,1,2,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (3,1,3,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (4,1,4,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (5,1,5,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (6,1,6,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (7,1,7,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (8,1,8,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (9,1,9,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (10,1,10,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (11,1,11,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (12,1,12,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (13,1,13,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (14,1,14,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (15,1,15,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (16,1,16,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (17,1,17,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (18,1,18,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (19,1,19,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (20,1,20,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (21,1,21,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (22,1,22,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (23,1,23,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (24,1,24,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (25,1,25,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (26,1,26,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (27,1,27,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (28,1,28,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (29,1,29,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (30,1,30,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (31,1,31,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (32,1,32,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (33,1,33,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (34,1,34,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (35,1,35,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (36,1,36,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (37,1,37,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (38,1,38,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (39,1,39,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (40,1,40,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (41,1,41,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (42,1,42,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (43,1,43,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (44,1,44,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (45,1,45,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (46,1,46,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (47,1,47,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (48,1,48,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (49,1,49,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (50,1,50,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (51,1,51,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (52,1,52,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (53,1,53,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (54,1,54,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (55,1,55,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (56,1,56,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (57,1,57,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (58,1,58,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (59,1,59,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (60,1,60,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (61,1,61,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (62,1,62,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (63,1,63,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (64,1,64,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (65,1,65,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (66,1,66,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (67,1,67,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (68,1,68,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (69,1,69,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (70,1,70,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (71,1,71,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (72,1,72,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (73,1,73,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (74,1,74,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (75,1,75,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (76,1,76,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (77,1,77,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (78,1,78,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (79,1,79,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (80,1,80,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (81,1,81,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (82,1,82,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (83,1,83,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (84,1,84,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (85,1,85,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (86,1,86,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (87,1,87,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (88,1,88,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (89,1,89,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (90,1,90,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (91,1,91,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (92,1,92,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (93,1,93,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (94,1,94,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (95,1,95,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (96,1,96,'IN_USE','NORMAL',NULL);
INSERT INTO `StocktakeRecord` (`id`,`sessionId`,`assetId`,`expectedStatus`,`actualStatus`,`remark`) VALUES (97,1,97,'IN_USE','NORMAL',NULL);

-- 系统日志 SystemLog
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (1,'分配','ALLOCATED','设备 DN-0001 分配给员工 张三','admin','2026-08-05 08:31:42.423');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (2,'归还','RETURNED','设备 DN-0004 由员工 李四 归还','admin','2026-08-05 08:31:42.423');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (3,'调拨','TRANSFERRED','设备 NB-0001 从技术部调拨到市场部','admin','2026-08-05 08:31:42.423');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (4,'报废','SCRAPPED','设备 DN-0002 已报废处理','admin','2026-08-05 08:31:42.423');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (5,'分配','ALLOCATED','设备 SW-0001 分配给员工 王五','admin','2026-08-05 08:31:42.423');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (6,'归还','RETURNED','设备 PR-0001 由员工 张三 归还','admin','2026-08-05 08:31:42.423');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (7,'asset','自动导入','创建设备 DT-2JG4DG (刘源的电脑主机)，分配给 刘源','system','2026-08-05 08:35:19.362');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (8,'asset','自动导入','创建设备 DT-7SUWHC (张艳茹的电脑主机)，分配给 张艳茹','system','2026-08-05 08:35:19.443');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (9,'asset','自动导入','创建设备 DT-7ZE5CW (李佳的电脑主机)，分配给 李佳','system','2026-08-05 08:35:19.538');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (10,'asset','自动导入','创建设备 DT-AAQPKU (李美双的电脑主机)，分配给 李美双','system','2026-08-05 08:35:19.666');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (11,'asset','自动导入','创建设备 DT-XAK3KU (赵闯的电脑主机)，分配给 赵闯','system','2026-08-05 08:35:24.185');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (12,'asset','自动导入','创建设备 DT-8GPUZW (秦梓涵的电脑主机)，分配给 秦梓涵','system','2026-08-05 08:35:24.289');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (13,'asset','自动导入','创建设备 DT-M2T3FR (李一娜的电脑主机)，分配给 李一娜','system','2026-08-05 08:35:24.386');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (14,'asset','自动导入','创建设备 DT-UXSR7U (周丽的电脑主机)，分配给 周丽','system','2026-08-05 08:35:24.523');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (15,'asset','自动导入','创建设备 DT-QYUCK8 (宋恬的电脑主机)，分配给 宋恬','system','2026-08-05 08:35:24.662');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (16,'asset','自动导入','创建设备 DT-8P24V5 (张良爽的电脑主机)，分配给 张良爽','system','2026-08-05 08:35:24.706');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (17,'asset','自动导入','创建设备 DT-AJJNH3 (袁雯珊的电脑主机)，分配给 袁雯珊','system','2026-08-05 08:35:24.763');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (18,'asset','自动导入','创建设备 DT-T4G3NF (魏栩莹的电脑主机)，分配给 魏栩莹','system','2026-08-05 08:35:24.951');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (19,'asset','自动导入','创建设备 DT-9WK2V9 (韩晓林的电脑主机)，分配给 韩晓林','system','2026-08-05 08:35:25.108');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (20,'asset','自动导入','创建设备 DT-7H6D28 (王璐瑀的电脑主机)，分配给 王璐瑀','system','2026-08-05 08:35:25.229');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (21,'asset','自动导入','创建设备 DT-ESZ83T (陈凯月的电脑主机)，分配给 陈凯月','system','2026-08-05 08:35:25.326');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (22,'asset','自动导入','创建设备 DT-SZSXN2 (王畅的电脑主机)，分配给 王畅','system','2026-08-05 08:35:25.422');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (23,'asset','自动导入','创建设备 DT-5R6KT3 (王艳华的电脑主机)，分配给 王艳华','system','2026-08-05 08:35:25.530');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (24,'asset','自动导入','创建设备 DT-Q5KC8P (乔雪坤的电脑主机)，分配给 乔雪坤','system','2026-08-05 08:35:25.642');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (25,'asset','自动导入','创建设备 DT-5AEY9C (黑德凯的电脑主机)，分配给 黑德凯','system','2026-08-05 08:35:25.739');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (26,'asset','自动导入','创建设备 DT-BUCF2K (徐佳红的电脑主机)，分配给 徐佳红','system','2026-08-05 08:35:25.884');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (27,'asset','自动导入','创建设备 DT-KPZUTE (王星戈的电脑主机)，分配给 王星戈','system','2026-08-05 08:35:26.052');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (28,'asset','自动导入','创建设备 DT-7EVDDZ (宫庆芳的电脑主机)，分配给 宫庆芳','system','2026-08-05 08:35:26.154');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (29,'asset','自动导入','创建设备 DT-TCGVVH (代城昊的电脑主机)，分配给 代城昊','system','2026-08-05 08:35:26.208');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (30,'asset','自动导入','创建设备 DT-KZ3VDN (高海兰的电脑主机)，分配给 高海兰','system','2026-08-05 08:35:26.275');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (31,'asset','自动导入','创建设备 DT-G9N4PB (祖国庆的电脑主机)，分配给 祖国庆','system','2026-08-05 08:35:36.110');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (32,'asset','自动导入','创建设备 DT-546KZE (刘美宁的电脑主机)，分配给 刘美宁','system','2026-08-05 08:35:36.222');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (33,'asset','自动导入','创建设备 DT-HXXPJ9 (王镜淇的电脑主机)，分配给 王镜淇','system','2026-08-05 08:35:36.357');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (34,'asset','自动导入','创建设备 DT-ZARUK8 (刘航的电脑主机)，分配给 刘航','system','2026-08-05 08:35:36.475');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (35,'asset','自动导入','创建设备 DT-Q8W4FP (任雅瑞的电脑主机)，分配给 任雅瑞','system','2026-08-05 08:35:36.561');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (36,'asset','自动导入','创建设备 DT-J7TKFV (赵鹏瑾的电脑主机)，分配给 赵鹏瑾','system','2026-08-05 08:35:36.604');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (37,'asset','自动导入','创建设备 DT-6TJ2RA (韩熹晨的电脑主机)，分配给 韩熹晨','system','2026-08-05 08:35:36.667');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (38,'asset','自动导入','创建设备 DT-76H9DN (李怡庆的电脑主机)，分配给 李怡庆','system','2026-08-05 08:35:43.713');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (39,'asset','自动导入','创建设备 DT-3CYBDN (杨柳的电脑主机)，分配给 杨柳','system','2026-08-05 08:35:43.968');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (40,'asset','自动导入','创建设备 DT-Z8FHKK (梁子丹的电脑主机)，分配给 梁子丹','system','2026-08-05 08:35:44.131');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (41,'asset','自动导入','创建设备 DT-6ZCP9T (张依的电脑主机)，分配给 张依','system','2026-08-05 08:35:44.267');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (42,'asset','自动导入','创建设备 DT-3VU2F6 (倪紫韵的电脑主机)，分配给 倪紫韵','system','2026-08-05 08:35:44.394');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (43,'asset','自动导入','创建设备 DT-2MB9PD (郑永蔷的电脑主机)，分配给 郑永蔷','system','2026-08-05 08:35:44.541');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (44,'asset','自动导入','创建设备 DT-H39VNX (李禹澎的电脑主机)，分配给 李禹澎','system','2026-08-05 08:35:44.653');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (45,'asset','自动导入','创建设备 DT-6WAUCV (袁永超的电脑主机)，分配给 袁永超','system','2026-08-05 08:35:44.779');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (46,'asset','自动导入','创建设备 DT-CJKTWB (徐欢的电脑主机)，分配给 徐欢','system','2026-08-05 08:35:44.922');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (47,'asset','自动导入','创建设备 DT-HPK93X (张燕的电脑主机)，分配给 张燕','system','2026-08-05 08:36:18.848');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (48,'asset','自动导入','创建设备 DT-VNXYXH (备用机电脑主机)，分配给 备用机','system','2026-08-05 08:36:18.937');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (49,'asset','自动导入','创建设备 DT-CTDDCW (龙腾云的电脑主机)，分配给 龙腾云','system','2026-08-05 08:36:19.068');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (50,'asset','自动导入','创建设备 DT-9NGGUN (唐月的电脑主机)，分配给 唐月','system','2026-08-05 08:36:19.156');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (51,'asset','自动导入','创建设备 DT-QRTWG9 (牛尚尚的电脑主机)，分配给 牛尚尚','system','2026-08-05 08:36:19.241');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (52,'asset','自动导入','创建设备 DT-6B2CQ2 (叼婷婷的电脑主机)，分配给 叼婷婷','system','2026-08-05 08:36:19.329');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (53,'asset','自动导入','创建设备 DT-TF6PQ2 (齐玉婷的电脑主机)，分配给 齐玉婷','system','2026-08-05 08:36:19.422');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (54,'asset','自动导入','创建设备 DT-V74PNW (徐金洋的电脑主机)，分配给 徐金洋','system','2026-08-05 08:36:23.742');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (55,'asset','自动导入','创建设备 DT-F73P75 (王婉芯的电脑主机)，分配给 王婉芯','system','2026-08-05 08:36:23.920');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (56,'asset','自动导入','创建设备 DT-VYUDBX (靳阔的电脑主机)，分配给 靳阔','system','2026-08-05 08:36:24.066');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (57,'asset','自动导入','创建设备 DT-YJ65T4 (陈荣荣的电脑主机)，分配给 陈荣荣','system','2026-08-05 08:36:24.176');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (58,'asset','自动导入','创建设备 DT-38Y29Q (杨美茹的电脑主机)，分配给 杨美茹','system','2026-08-05 08:36:24.265');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (59,'asset','自动导入','创建设备 DT-Q4QKFN (卞雲吉的电脑主机)，分配给 卞雲吉','system','2026-08-05 08:36:24.417');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (60,'asset','自动导入','创建设备 DT-CBEN62 (孟子暄的电脑主机)，分配给 孟子暄','system','2026-08-05 08:36:24.541');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (61,'asset','自动导入','创建设备 DT-FCNNVD (左丽杰的电脑主机)，分配给 左丽杰','system','2026-08-05 08:36:29.330');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (62,'asset','自动导入','创建设备 DT-EJKAF6 (司尚宇的电脑主机)，分配给 司尚宇','system','2026-08-05 08:36:29.395');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (63,'asset','自动导入','创建设备 DT-7MVYTV (罗惠芙的电脑主机)，分配给 罗惠芙','system','2026-08-05 08:36:29.482');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (64,'asset','自动导入','创建设备 DT-CMS7SK (杨程涵的电脑主机)，分配给 杨程涵','system','2026-08-05 08:36:29.592');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (65,'asset','自动导入','创建设备 DT-VNS5EZ (田岩艳的电脑主机)，分配给 田岩艳','system','2026-08-05 08:36:29.703');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (66,'asset','自动导入','创建设备 DT-2ZYABF (支俊慧的电脑主机)，分配给 支俊慧','system','2026-08-05 08:36:29.749');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (67,'asset','自动导入','创建设备 DT-HV8QR8 (武冠岐的电脑主机)，分配给 武冠岐','system','2026-08-05 08:36:29.808');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (68,'asset','自动导入','创建设备 DT-HC3PGS (王倩的电脑主机)，分配给 王倩','system','2026-08-05 08:36:29.965');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (69,'asset','自动导入','创建设备 DT-ZNDAXZ (刘柏利的电脑主机)，分配给 刘柏利','system','2026-08-05 08:36:34.804');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (70,'asset','自动导入','创建设备 DT-3VHXAK (郭薇的电脑主机)，分配给 郭薇','system','2026-08-05 08:36:34.959');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (71,'asset','自动导入','创建设备 DT-7KFZVK (王书丽的电脑主机)，分配给 王书丽','system','2026-08-06 02:12:41.587');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (72,'asset','自动导入','创建设备 DT-K2DE7P (刘学同的电脑主机)，分配给 刘学同','system','2026-08-06 02:12:41.701');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (73,'asset','自动导入','创建设备 DT-5X9DUN (宋智辉的电脑主机)，分配给 宋智辉','system','2026-08-06 02:12:41.903');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (74,'asset','自动导入','创建设备 DT-29VV4D (李一航的电脑主机)，分配给 李一航','system','2026-08-06 02:12:42.008');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (75,'asset','自动导入','创建设备 DT-4GYAYJ (张令侠的电脑主机)，分配给 张令侠','system','2026-08-06 02:12:42.115');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (76,'asset','自动导入','创建设备 DT-HN2BTW (梁玉彤的电脑主机)，分配给 梁玉彤','system','2026-08-06 02:12:42.257');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (77,'asset','自动导入','创建设备 DT-5DHUZ7 (范晓雨的电脑主机)，分配给 范晓雨','system','2026-08-06 02:12:55.541');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (78,'asset','自动导入','创建设备 DT-CY7FDS (姜姝含的电脑主机)，分配给 姜姝含','system','2026-08-06 02:12:55.610');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (79,'asset','自动导入','创建设备 DT-EQ6P5Q (郭文杰的电脑主机)，分配给 郭文杰','system','2026-08-06 02:12:55.778');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (80,'asset','自动导入','创建设备 DT-BMC9PJ (姜舒月的电脑主机)，分配给 姜舒月','system','2026-08-06 02:12:55.952');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (81,'asset','自动导入','创建设备 DT-976SX6 (刘勃瑶的电脑主机)，分配给 刘勃瑶','system','2026-08-06 02:12:56.104');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (82,'asset','自动导入','创建设备 DT-BBSK4J (刘京的电脑主机)，分配给 刘京','system','2026-08-06 02:12:56.189');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (83,'asset','自动导入','创建设备 DT-TCDRW5 (刘雅的电脑主机)，分配给 刘雅','system','2026-08-06 02:12:56.321');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (84,'asset','自动导入','创建设备 DT-X38GWJ (卢琦的电脑主机)，分配给 卢琦','system','2026-08-06 02:12:56.471');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (85,'asset','自动导入','创建设备 DT-GQ9X6V (王培畅的电脑主机)，分配给 王培畅','system','2026-08-06 02:12:56.563');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (86,'asset','自动导入','创建设备 DT-EN4YFX (于虹玉的电脑主机)，分配给 于虹玉','system','2026-08-06 02:13:00.289');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (87,'asset','自动导入','创建设备 DT-NN43WS (田鹤松的主机)，分配给 田鹤松','system','2026-08-06 02:30:05.989');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (88,'asset','自动导入','创建设备 DT-9WS2H8 (曹靖宇的电脑主机)，分配给 曹靖宇','system','2026-08-06 05:44:21.247');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (89,'asset','自动导入','创建设备 DT-C9863C (服务器旁的电脑主机)，分配给 服务器旁','system','2026-08-06 05:44:24.521');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (90,'asset','自动导入','创建设备 DT-D2X2N2 (晋航帆的电脑主机)，分配给 晋航帆','system','2026-08-06 05:44:27.477');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (91,'asset','自动导入','创建设备 DT-UYQ973 (李策的电脑主机)，分配给 李策','system','2026-08-06 05:44:30.652');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (92,'asset','自动导入','创建设备 DT-SWR7WM (李朔的电脑主机)，分配给 李朔','system','2026-08-06 05:44:34.148');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (93,'asset','自动导入','创建设备 DT-MH75FJ (孟石梅的电脑主机)，分配给 孟石梅','system','2026-08-06 05:44:37.671');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (94,'asset','自动导入','创建设备 DT-6TPGC3 (乔欣颖的电脑主机)，分配给 乔欣颖','system','2026-08-06 05:44:41.023');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (95,'asset','自动导入','创建设备 DT-VBK4FE (宋亚培的电脑主机)，分配给 宋亚培','system','2026-08-06 05:44:44.296');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (96,'asset','自动导入','创建设备 DT-57K3HF (王丹的电脑主机)，分配给 王丹','system','2026-08-06 05:44:48.022');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (97,'asset','自动导入','创建设备 DT-UE32Y7 (王佳琦的电脑主机)，分配给 王佳琦','system','2026-08-06 05:44:51.693');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (98,'asset','自动导入','创建设备 DT-XAV8PS (徐凯豪的电脑主机)，分配给 徐凯豪','system','2026-08-06 05:44:55.752');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (99,'asset','自动导入','创建设备 DT-3ZABG7 (张紫丹的电脑主机)，分配给 张紫丹','system','2026-08-06 05:45:00.196');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (100,'asset','自动导入','创建设备 DT-XY2VY5 (赵文丽的电脑主机)，分配给 赵文丽','system','2026-08-06 05:45:03.726');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (101,'asset','自动导入','创建设备 DT-M3WNJE (闲置1的电脑主机)，分配给 闲置1','system','2026-08-06 06:07:27.834');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (102,'asset','自动导入','创建设备 DT-XDWDNH (肖旭的电脑主机)，分配给 肖旭','system','2026-08-06 06:07:32.143');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (103,'asset','自动导入','创建设备 DT-TNQ5EX (闲置1的电脑主机)，分配给 闲置1','system','2026-08-06 06:07:36.099');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (104,'asset','自动导入','创建设备 DT-B495ND (陆航的电脑主机)，分配给 陆航','system','2026-08-06 08:51:55.270');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (105,'asset','自动导入','创建设备 DT-TKTBRV (李洁的电脑主机)，分配给 李洁','system','2026-08-06 08:51:55.337');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (106,'asset','自动导入','创建设备 DT-STXNTU (申靖淼的电脑主机)，分配给 申靖淼','system','2026-08-06 08:51:55.509');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (107,'asset','自动导入','创建设备 DT-MPBMDK (杨淼的电脑主机)，分配给 杨淼','system','2026-08-06 10:13:45.392');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (108,'asset','自动导入','创建设备 DT-B7F5UR (共享的电脑主机)，分配给 共享','system','2026-08-06 10:13:45.528');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (109,'asset','自动导入','创建设备 DT-WTE4KX (邬重阳的电脑主机)，分配给 邬重阳','system','2026-08-06 10:13:45.663');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (110,'asset','自动导入','创建设备 DT-ZYM3VC (刘婷.的电脑主机)，分配给 刘婷.','system','2026-08-06 10:13:45.729');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (111,'asset','自动导入','创建设备 DT-PJ4M9J (张劭轩的电脑主机)，分配给 张劭轩','system','2026-08-06 10:13:45.804');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (112,'asset','自动导入','创建设备 DT-KFMF5Y (张佳怡的电脑主机)，分配给 张佳怡','system','2026-08-06 10:13:45.910');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (113,'asset','自动导入','创建设备 DT-NHMYKH (郭建华的电脑主机)，分配给 郭建华','system','2026-08-06 10:13:46.005');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (114,'asset','自动导入','创建设备 DT-AST8UN (冯红丽的电脑主机)，分配给 冯红丽','system','2026-08-06 10:13:46.168');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (115,'asset','自动导入','创建设备 DT-BU8VS7 (勾洋洋的电脑主机)，分配给 勾洋洋','system','2026-08-06 10:13:46.359');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (116,'asset','自动导入','创建设备 DT-U523FS (刘婷的电脑主机)，分配给 刘婷','system','2026-08-06 10:13:46.506');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (117,'asset','自动导入','创建设备 DT-N9AVRT (高敏的电脑主机)，分配给 高敏','system','2026-08-06 10:13:46.632');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (118,'asset','自动导入','创建设备 DT-PNC67Y (刘雅婧的电脑主机)，分配给 刘雅婧','system','2026-08-07 01:38:48.877');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (119,'asset','自动导入','创建设备 DT-AMY88B (尚煜函的电脑主机)，分配给 尚煜函','system','2026-08-07 01:38:49.040');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (120,'asset','自动导入','创建设备 DT-67SC99 (张瑞同的电脑主机)，分配给 张瑞同','system','2026-08-07 01:38:49.199');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (121,'asset','自动导入','创建设备 DT-8KHKTZ (闫欣宇的电脑主机)，分配给 闫欣宇','system','2026-08-07 01:38:49.339');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (122,'asset','自动导入','创建设备 DT-EWTETG (郭欣欣的电脑主机)，分配给 郭欣欣','system','2026-08-07 01:38:49.485');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (123,'asset','自动导入','创建设备 DT-8J3DVU (陈爽的电脑主机)，分配给 陈爽','system','2026-08-07 01:39:02.352');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (124,'配置变更','调整设备配件','设备 DT-8J3DVU：-1 16GB DDR2666MHz','admin','2026-08-07 01:39:50.687');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (125,'asset','自动导入','创建设备 DT-2MPZZC (陈爽的电脑主机)，分配给 陈爽','system','2026-08-11 03:38:41.084');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (126,'asset','自动导入','创建设备 DT-2ARWBN (刘源的电脑主机)，分配给 刘源','system','2026-08-11 03:38:48.526');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (127,'asset','自动导入','创建设备 DT-C6S6UE (郑永蔷的电脑主机)，分配给 郑永蔷','system','2026-08-11 03:38:48.551');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (128,'asset','自动导入','创建设备 DT-PH246R (支俊慧的电脑主机)，分配给 支俊慧','system','2026-08-11 03:38:48.586');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (129,'asset','自动导入','创建设备 DT-B33SH2 (杨美茹的电脑主机)，分配给 杨美茹','system','2026-08-11 03:38:48.635');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (130,'asset','自动导入','创建设备 DT-WQRQBG (杨柳的电脑主机)，分配给 杨柳','system','2026-08-11 03:38:48.696');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (131,'asset','自动导入','创建设备 DT-6BSD7M (郭薇的电脑主机)，分配给 郭薇','system','2026-08-11 03:38:48.746');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (132,'asset','自动导入','创建设备 DT-FF7MF7 (倪紫韵的电脑主机)，分配给 倪紫韵','system','2026-08-11 03:38:48.803');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (133,'asset','自动导入','创建设备 DT-5A8QWP (刘美宁的电脑主机)，分配给 刘美宁','system','2026-08-11 03:38:48.851');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (134,'asset','自动导入','创建设备 DT-W7UHUU (黑德凯的电脑主机)，分配给 黑德凯','system','2026-08-11 03:38:48.901');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (135,'asset','自动导入','创建设备 DT-6WFEVN (王艳华的电脑主机)，分配给 王艳华','system','2026-08-11 03:38:48.986');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (136,'asset','自动导入','创建设备 DT-PPP9HX (叼婷婷的电脑主机)，分配给 叼婷婷','system','2026-08-11 03:38:49.056');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (137,'asset','自动导入','创建设备 DT-J9JSXQ (韩熹晨的电脑主机)，分配给 韩熹晨','system','2026-08-11 03:38:49.107');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (138,'asset','自动导入','创建设备 DT-KQY3YG (袁永超的电脑主机)，分配给 袁永超','system','2026-08-11 03:38:49.154');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (139,'asset','自动导入','创建设备 DT-DQJPZQ (张依的电脑主机)，分配给 张依','system','2026-08-11 03:38:49.199');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (140,'asset','自动导入','创建设备 DT-25W28W (李怡庆的电脑主机)，分配给 李怡庆','system','2026-08-11 03:38:49.247');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (141,'asset','自动导入','创建设备 DT-S33H9U (宫庆芳的电脑主机)，分配给 宫庆芳','system','2026-08-11 03:38:49.296');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (142,'asset','自动导入','创建设备 DT-SZFFT5 (王璐瑀的电脑主机)，分配给 王璐瑀','system','2026-08-11 03:38:49.345');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (143,'asset','自动导入','创建设备 DT-TPBF2S (罗惠芙的电脑主机)，分配给 罗惠芙','system','2026-08-11 03:38:49.395');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (144,'asset','自动导入','创建设备 DT-SYF5TK (张艳茹的电脑主机)，分配给 张艳茹','system','2026-08-11 03:38:49.444');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (145,'asset','自动导入','创建设备 DT-ZQ4TFH (李佳的电脑主机)，分配给 李佳','system','2026-08-11 03:38:49.497');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (146,'asset','自动导入','创建设备 DT-ZCFM4Q (秦梓涵的电脑主机)，分配给 秦梓涵','system','2026-08-11 03:38:49.542');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (147,'asset','自动导入','创建设备 DT-BBPSKR (张良爽的电脑主机)，分配给 张良爽','system','2026-08-11 03:38:49.591');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (148,'asset','自动导入','创建设备 DT-T7V2XE (唐月的电脑主机)，分配给 唐月','system','2026-08-11 03:38:49.635');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (149,'asset','自动导入','创建设备 DT-ZAV4N9 (韩晓林的电脑主机)，分配给 韩晓林','system','2026-08-11 03:38:49.681');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (150,'asset','自动导入','创建设备 DT-PYBMU9 (李美双的电脑主机)，分配给 李美双','system','2026-08-11 03:38:49.727');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (151,'asset','自动导入','创建设备 DT-EXFF59 (袁雯珊的电脑主机)，分配给 袁雯珊','system','2026-08-11 03:38:49.771');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (152,'asset','自动导入','创建设备 DT-TC5EBW (徐佳红的电脑主机)，分配给 徐佳红','system','2026-08-11 03:38:49.816');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (153,'asset','自动导入','创建设备 DT-J3N7ZH (孟子暄的电脑主机)，分配给 孟子暄','system','2026-08-11 03:38:49.866');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (154,'asset','自动导入','创建设备 DT-DYENA7 (徐欢的电脑主机)，分配给 徐欢','system','2026-08-11 03:38:49.915');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (155,'asset','自动导入','创建设备 DT-UHZ7TZ (杨程涵的电脑主机)，分配给 杨程涵','system','2026-08-11 03:38:49.960');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (156,'asset','自动导入','创建设备 DT-74KZDH (龙腾云的电脑主机)，分配给 龙腾云','system','2026-08-11 03:38:50.004');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (157,'asset','自动导入','创建设备 DT-4GFRTT (司尚宇的电脑主机)，分配给 司尚宇','system','2026-08-11 03:38:50.050');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (158,'asset','自动导入','创建设备 DT-ZG8ZKB (陈凯月的电脑主机)，分配给 陈凯月','system','2026-08-11 03:38:50.097');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (159,'asset','自动导入','创建设备 DT-9T6VNS (王婉芯的电脑主机)，分配给 王婉芯','system','2026-08-11 03:38:50.144');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (160,'asset','自动导入','创建设备 DT-KA8DGV (左丽杰的电脑主机)，分配给 左丽杰','system','2026-08-11 03:38:50.191');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (161,'asset','自动导入','创建设备 DT-RZERAT (祖国庆的电脑主机)，分配给 祖国庆','system','2026-08-11 03:38:50.241');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (162,'asset','自动导入','创建设备 DT-CWNUW7 (李禹澎的电脑主机)，分配给 李禹澎','system','2026-08-11 03:38:50.285');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (163,'asset','自动导入','创建设备 DT-AV9KC7 (王倩的电脑主机)，分配给 王倩','system','2026-08-11 03:38:50.334');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (164,'asset','自动导入','创建设备 DT-B25NQW (张燕的电脑主机)，分配给 张燕','system','2026-08-11 03:38:50.379');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (165,'asset','自动导入','创建设备 DT-ANKRDN (武冠岐的电脑主机)，分配给 武冠岐','system','2026-08-11 03:38:50.425');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (166,'asset','自动导入','创建设备 DT-T6MAVZ (王镜淇的电脑主机)，分配给 王镜淇','system','2026-08-11 03:38:50.474');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (167,'asset','自动导入','创建设备 DT-26HFPU (赵鹏瑾的电脑主机)，分配给 赵鹏瑾','system','2026-08-11 03:38:50.522');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (168,'asset','自动导入','创建设备 DT-DQSWX9 (王星戈的电脑主机)，分配给 王星戈','system','2026-08-11 03:38:50.565');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (169,'asset','自动导入','创建设备 DT-9ACQ7K (高海兰的电脑主机)，分配给 高海兰','system','2026-08-11 03:38:50.615');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (170,'asset','自动导入','创建设备 DT-XQUH4A (李一娜的电脑主机)，分配给 李一娜','system','2026-08-11 03:38:50.663');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (171,'asset','自动导入','创建设备 DT-9WNCFV (卞雲吉的电脑主机)，分配给 卞雲吉','system','2026-08-11 03:38:50.709');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (172,'asset','自动导入','创建设备 DT-STU9DW (乔雪坤的电脑主机)，分配给 乔雪坤','system','2026-08-11 03:38:50.757');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (173,'asset','自动导入','创建设备 DT-PM9HJ9 (任雅瑞的电脑主机)，分配给 任雅瑞','system','2026-08-11 03:38:50.803');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (174,'asset','自动导入','创建设备 DT-3MV69Z (牛尚尚的电脑主机)，分配给 牛尚尚','system','2026-08-11 03:38:50.851');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (175,'asset','自动导入','创建设备 DT-FBE6DK (宋恬的电脑主机)，分配给 宋恬','system','2026-08-11 03:38:50.895');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (176,'asset','自动导入','创建设备 DT-WRNYB9 (王畅的电脑主机)，分配给 王畅','system','2026-08-11 03:38:50.941');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (177,'asset','自动导入','创建设备 DT-GY8SNC (魏栩莹的电脑主机)，分配给 魏栩莹','system','2026-08-11 03:38:50.993');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (178,'asset','自动导入','创建设备 DT-9UPQRX (代城昊的电脑主机)，分配给 代城昊','system','2026-08-11 03:38:51.039');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (179,'asset','自动导入','创建设备 DT-CTWF69 (齐玉婷的电脑主机)，分配给 齐玉婷','system','2026-08-11 03:38:51.091');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (180,'asset','自动导入','创建设备 DT-TTT82M (周丽的电脑主机)，分配给 周丽','system','2026-08-11 03:38:51.133');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (181,'asset','自动导入','创建设备 DT-EP5R8U (徐金洋的电脑主机)，分配给 徐金洋','system','2026-08-11 03:38:51.159');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (182,'asset','自动导入','创建设备 DT-CQK2FX (田岩艳的电脑主机)，分配给 田岩艳','system','2026-08-11 03:38:51.189');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (183,'asset','自动导入','创建设备 DT-7YTPKX (备用机电脑主机)，分配给 备用机','system','2026-08-11 03:38:51.215');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (184,'asset','自动导入','创建设备 DT-683CZA (靳阔的电脑主机)，分配给 靳阔','system','2026-08-11 03:38:51.270');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (185,'asset','自动导入','创建设备 DT-CD5KAR (赵闯的电脑主机)，分配给 赵闯','system','2026-08-11 03:38:51.319');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (186,'asset','自动导入','创建设备 DT-B34M3G (陈荣荣的电脑主机)，分配给 陈荣荣','system','2026-08-11 03:38:51.365');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (187,'asset','自动导入','创建设备 DT-9G7QTF (梁子丹的电脑主机)，分配给 梁子丹','system','2026-08-11 03:38:51.409');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (188,'asset','自动导入','创建设备 DT-XDTCR7 (刘航的电脑主机)，分配给 刘航','system','2026-08-11 03:38:51.457');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (189,'asset','自动导入','创建设备 DT-Y95XTK (刘柏利的电脑主机)，分配给 刘柏利','system','2026-08-11 03:38:51.503');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (190,'asset','自动导入','创建设备 DT-C5C9XP (赵宏颖的电脑主机)，分配给 赵宏颖','system','2026-08-11 03:52:21.521');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (191,'asset','自动导入','创建设备 DT-4KBF98 (相聪的电脑主机)，分配给 相聪','system','2026-08-11 03:52:26.145');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (192,'asset','自动导入','创建设备 DT-7R57BY (空闲1的电脑主机)，分配给 空闲1','system','2026-08-11 06:10:50.034');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (193,'asset','自动导入','创建设备 DT-F6FQNW (空闲2的电脑主机)，分配给 空闲2','system','2026-08-11 06:10:54.954');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (194,'asset','自动导入','创建设备 DT-JA2DEG (空闲3的电脑主机)，分配给 空闲3','system','2026-08-11 06:10:58.235');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (195,'asset','自动导入','创建设备 DT-S4YZZF (空闲4的电脑主机)，分配给 空闲4','system','2026-08-11 06:11:01.414');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (196,'归还','归还设备','归还设备 DT-7R57BY、DT-F6FQNW、DT-JA2DEG、DT-S4YZZF','admin','2026-08-11 06:13:29.682');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (197,'归还','归还设备','归还设备 DT-AAQPKU','admin','2026-08-11 06:13:44.258');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (198,'分配','分配设备','将 DT-JA2DEG 分配给 李美双','admin','2026-08-11 06:13:57.609');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (199,'分配','分配设备','将 NB-WPT9HW 分配给 程哥','admin','2026-08-11 06:35:22.571');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (200,'分配','分配设备','将 NB-S9AM56 分配给 会议室戴尔笔记本','admin','2026-08-12 02:15:08.527');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (201,'分配','分配设备','将 NB-YPX5A6 分配给 会议室联想笔记本','admin','2026-08-12 02:15:20.719');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (202,'asset','自动导入','创建设备 DT-33QBWW (赵颖的电脑主机)，分配给 赵颖','system','2026-08-13 06:18:41.756');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (203,'asset','自动导入','创建设备 DT-Z7Z945 (杜晨阳的电脑主机)，分配给 杜晨阳','system','2026-08-13 06:18:41.878');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (204,'asset','自动导入','创建设备 DT-HUUC4H (刘千慧的电脑主机)，分配给 刘千慧','system','2026-08-13 06:18:41.977');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (205,'asset','自动导入','创建设备 DT-SSEBME (韩洪宇的电脑主机)，分配给 韩洪宇','system','2026-08-13 06:18:42.108');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (206,'asset','自动导入','创建设备 DT-XJZGJW (张钰的电脑主机)，分配给 张钰','system','2026-08-13 06:19:34.917');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (207,'归还','归还设备','归还设备 DT-D2X2N2','admin','2026-08-21 01:43:48.242');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (208,'分配','分配设备','将 DT-S4YZZF 分配给 晋航帆','admin','2026-08-21 01:44:32.339');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (209,'送修','送修设备','送修设备 DT-D2X2N2','admin','2026-08-21 01:44:54.757');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (210,'分配','分配设备','将 DT-AAQPKU 分配给 罗文','admin','2026-08-31 01:17:23.620');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (211,'归还','归还设备','归还设备 DT-M3WNJE','admin','2026-09-10 06:20:23.983');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (212,'归还','归还设备','归还设备 DT-TNQ5EX','admin','2026-09-10 06:26:45.087');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (213,'asset','自动导入','创建设备 DT-HZM8NC (1的电脑主机)，分配给 1','system','2026-09-10 07:23:45.092');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (214,'归还','归还设备','归还设备 DT-HZM8NC','admin','2026-09-10 07:36:54.574');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (215,'asset','自动导入','创建设备 DT-FG4Z49 (1的电脑主机)，分配给 1','system','2026-09-10 07:47:01.148');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (216,'归还','归还设备','归还设备 DT-FG4Z49','admin','2026-09-10 07:47:43.256');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (217,'归还','归还设备','归还设备 DT-H39VNX','admin','2026-09-11 04:21:40.806');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (218,'分配','分配设备','将 DT-FG4Z49 分配给 郭启峰','admin','2026-09-11 04:22:21.786');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (219,'入库','采购入库','双飞燕键盘 入库 1 件','admin','2026-09-11 04:27:14.778');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (220,'配置变更','调整设备配件','设备 DT-2JG4DG：+1 双飞燕键盘','admin','2026-09-11 04:27:36.869');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (221,'入库','采购入库','双飞燕键盘 入库 12 件','admin','2026-09-11 04:40:05.971');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (222,'入库','采购入库','罗技键盘 入库 1 件','admin','2026-09-11 04:40:13.426');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (223,'入库','采购入库','悉硕键盘 入库 9 件','admin','2026-09-11 04:40:25.129');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (224,'入库','采购入库','戴尔键盘 入库 1 件','admin','2026-09-11 04:40:35.741');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (225,'入库','采购入库','惠普键盘 入库 3 件','admin','2026-09-11 04:41:07.799');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (226,'入库','采购入库','双飞燕键盘 入库 1 件','admin','2026-09-11 04:44:44.301');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (227,'归还','归还设备','归还设备 DT-EQ6P5Q','admin','2026-09-11 07:09:18.520');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (228,'asset','自动导入','创建设备 DT-QYQ6BS (12的电脑主机)，分配给 12','system','2026-09-11 08:53:36.691');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (229,'归还','归还设备','归还设备 DT-QYQ6BS','admin','2026-09-11 08:54:23.562');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (230,'维修完成','维修完成','设备 DT-D2X2N2 维修完成','admin','2026-09-11 09:01:28.989');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (231,'归还','归还设备','归还设备 DT-C9863C','admin','2026-09-11 12:21:58.515');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (232,'归还','归还设备','归还设备 DT-CY7FDS','admin','2026-09-11 12:39:18.575');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (233,'asset','自动导入','创建设备 DT-NE5XBD (12的电脑主机)，分配给 12','system','2026-09-11 13:00:03.401');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (234,'asset','自动导入','创建设备 DT-RD24Y7 (12的电脑主机)，分配给 12','system','2026-09-11 13:00:19.472');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (235,'归还','归还设备','归还设备 DT-NE5XBD','admin','2026-09-11 13:00:53.329');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (236,'入库','采购入库','惠普键盘 入库 1 件','admin','2026-09-15 01:32:57.795');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (237,'分配','分配设备','将 DT-F6FQNW 分配给 员工001','admin','2026-09-15 01:52:35.735');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (238,'归还','归还设备','归还设备 DT-F6FQNW','admin','2026-09-15 01:52:58.208');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (239,'归还','归还设备','归还设备 DT-3CYBDN','admin','2026-09-15 02:22:47.644');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (240,'分配','分配设备','将 DT-CY7FDS 分配给 杨柳','admin','2026-09-15 02:23:11.054');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (241,'归还','归还设备','归还设备 DT-GQ9X6V','admin','2026-09-15 03:33:06.482');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (242,'归还','归还设备','归还设备 DT-X38GWJ','admin','2026-09-15 03:35:01.881');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (243,'分配','分配设备','将 DT-X38GWJ 分配给 杨娣','admin','2026-09-15 03:35:24.714');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (244,'归还','归还设备','归还设备 DT-976SX6','admin','2026-09-15 03:39:34.198');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (245,'分配','分配设备','将 DT-976SX6 分配给 郭文杰','admin','2026-09-15 03:39:52.376');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (246,'配置变更','调整设备配件','设备 DT-3VHXAK：+1 双飞燕键盘','admin','2026-09-15 04:19:40.222');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (247,'入库','采购入库','飞利浦鼠标 入库 20 件','admin','2026-09-16 03:05:34.706');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (248,'归还','归还设备','归还设备 DT-VNXYXH','admin','2026-09-17 08:36:47.286');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (249,'分配','分配设备','将 DT-VNXYXH 分配给 王宇轩','admin','2026-09-17 08:38:03.802');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (250,'配置变更','调整设备配件','设备 DT-VNXYXH：+1 飞利浦鼠标','admin','2026-09-17 08:42:08.771');
INSERT INTO `SystemLog` (`id`,`module`,`action`,`detail`,`operator`,`createdAt`) VALUES (251,'归还','归还设备','归还设备 DT-Q4QKFN','admin','2026-09-21 05:18:46.857');

/* ---------- 登录账号 ----------
 * 1) admin：保留旧密码哈希(老密码可登录)，SUPER_ADMIN，isActive，departmentScope=ALL
 * 2) 每员工 1 账号：username=工号 / EMPLOYEE / mustChangePassword=true / 默认密码 123456 */
-- 账号 Admin（admin + 员工自动建号）

INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (1,'admin','$2b$10$JEJalaukxxWqfgkzs/xnaOYUGv4N5EUvtdRZtAy0dXhKuCDLPhs.O','系统管理员',1,NULL,'ALL',1,0,'2026-08-05 08:31:42.403','2026-08-05 08:31:42.403');

INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (2,'EMP0001','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘源',4,1,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (3,'EMP0002','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','张艳茹',4,2,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (4,'EMP0003','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','李佳',4,3,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (5,'EMP0004','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','李美双',4,4,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (6,'EMP0005','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','赵闯',4,5,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (7,'EMP0006','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','秦梓涵',4,6,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (8,'EMP0007','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','李一娜',4,7,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (9,'EMP0008','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','周丽',4,8,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (10,'EMP0009','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','宋恬',4,9,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (11,'EMP0010','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','张良爽',4,10,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (12,'EMP0011','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','袁雯珊',4,11,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (13,'EMP0012','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','魏栩莹',4,12,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (14,'EMP0013','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','韩晓林',4,13,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (15,'EMP0014','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王璐瑀',4,14,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (16,'EMP0015','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','陈凯月',4,15,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (17,'EMP0016','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王畅',4,16,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (18,'EMP0017','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王艳华',4,17,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (19,'EMP0018','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','乔雪坤',4,18,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (20,'EMP0019','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','黑德凯',4,19,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (21,'EMP0020','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','徐佳红',4,20,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (22,'EMP0021','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王星戈',4,21,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (23,'EMP0022','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','宫庆芳',4,22,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (24,'EMP0023','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','代城昊',4,23,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (25,'EMP0024','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','高海兰',4,24,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (26,'EMP0025','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','祖国庆',4,25,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (27,'EMP0026','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘美宁',4,26,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (28,'EMP0027','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王镜淇',4,27,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (29,'EMP0028','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘航',4,28,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (30,'EMP0029','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','任雅瑞',4,29,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (31,'EMP0030','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','赵鹏瑾',4,30,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (32,'EMP0031','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','韩熹晨',4,31,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (33,'EMP0032','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','李怡庆',4,32,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (34,'EMP0033','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','杨柳',4,33,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (35,'EMP0034','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','梁子丹',4,34,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (36,'EMP0035','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','张依',4,35,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (37,'EMP0036','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','倪紫韵',4,36,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (38,'EMP0037','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','郑永蔷',4,37,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (39,'EMP0038','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','郭启峰',4,38,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (40,'EMP0039','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','袁永超',4,39,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (41,'EMP0040','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','徐欢',4,40,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (42,'EMP0041','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','张燕',4,41,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (43,'EMP0042','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','备用机',4,42,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (44,'EMP0043','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','龙腾云',4,43,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (45,'EMP0044','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','唐月',4,44,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (46,'EMP0045','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','牛尚尚',4,45,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (47,'EMP0046','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','叼婷婷',4,46,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (48,'EMP0047','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','齐玉婷',4,47,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (49,'EMP0048','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','徐金洋',4,48,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (50,'EMP0049','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘勃瑶',4,49,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (51,'EMP0050','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','靳阔',4,50,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (52,'EMP0051','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','陈荣荣',4,51,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (53,'EMP0052','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','杨美茹',4,52,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (54,'EMP0053','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','卞雲吉',4,53,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (55,'EMP0054','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','孟子暄',4,54,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (56,'EMP0055','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','左丽杰',4,55,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (57,'EMP0056','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','司尚宇',4,56,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (58,'EMP0057','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','罗惠芙',4,57,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (59,'EMP0058','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','杨程涵',4,58,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (60,'EMP0059','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','田岩艳',4,59,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (61,'EMP0060','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','支俊慧',4,60,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (62,'EMP0061','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','武冠岐',4,61,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (63,'EMP0062','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王倩',4,62,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (64,'EMP0063','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘柏利',4,63,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (65,'EMP0064','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','郭薇',4,64,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (66,'EMP0065','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王书丽',4,65,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (67,'EMP0066','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘学同',4,66,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (68,'EMP0067','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','宋智辉',4,67,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (69,'EMP0068','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','李一航',4,68,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (70,'EMP0069','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','张令侠',4,69,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (71,'EMP0070','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','梁玉彤',4,70,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (72,'EMP0071','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','范晓雨',4,71,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (73,'EMP0072','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','姜姝含',4,72,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (74,'EMP0073','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','郭文杰',4,73,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (75,'EMP0074','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','姜舒月',4,74,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (76,'EMP0076','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘京',4,76,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (77,'EMP0077','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘雅',4,77,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (78,'EMP0078','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','杨娣',4,78,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (79,'EMP0079','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王培畅',4,79,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (80,'EMP0080','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','于虹玉',4,80,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (81,'EMP0081','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','田鹤松',4,81,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (82,'EMP0082','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','曹靖宇',4,82,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (83,'EMP0083','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','服务器旁',4,83,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (84,'EMP0084','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','晋航帆',4,84,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (85,'EMP0085','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','李策',4,85,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (86,'EMP0086','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','李朔',4,86,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (87,'EMP0087','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','孟石梅',4,87,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (88,'EMP0088','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','乔欣颖',4,88,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (89,'EMP0089','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','宋亚培',4,89,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (90,'EMP0090','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王丹',4,90,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (91,'EMP0091','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王佳琦',4,91,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (92,'EMP0092','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','徐凯豪',4,92,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (93,'EMP0093','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','张紫丹',4,93,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (94,'EMP0094','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','赵文丽',4,94,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (95,'EMP0095','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','闲置1',4,95,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (96,'EMP0096','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','肖旭',4,96,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (97,'EMP0097','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','陆航',4,97,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (98,'EMP0098','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','李洁',4,98,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (99,'EMP0099','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','申靖淼',4,99,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (100,'EMP0100','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','杨淼',4,100,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (101,'EMP0101','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','共享',4,101,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (102,'EMP0102','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','邬重阳',4,102,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (103,'EMP0103','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘婷.',4,103,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (104,'EMP0104','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','张劭轩',4,104,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (105,'EMP0105','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','张佳怡',4,105,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (106,'EMP0106','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','郭建华',4,106,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (107,'EMP0107','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','冯红丽',4,107,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (108,'EMP0108','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','勾洋洋',4,108,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (109,'EMP0109','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘婷',4,109,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (110,'EMP0110','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','高敏',4,110,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (111,'EMP0111','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘雅婧',4,111,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (112,'EMP0112','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','尚煜函',4,112,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (113,'EMP0113','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','张瑞同',4,113,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (114,'EMP0114','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','闫欣宇',4,114,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (115,'EMP0115','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','郭欣欣',4,115,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (116,'EMP0116','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','陈爽',4,116,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (117,'EMP0117','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','赵宏颖',4,117,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (118,'EMP0118','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','相聪',4,118,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (119,'EMP0119','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','空闲1',4,119,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (120,'EMP0120','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','空闲2',4,120,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (121,'EMP0121','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','空闲3',4,121,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (122,'EMP0122','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','空闲4',4,122,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (123,'EMP0123','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','程哥',4,123,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (124,'EMP0124','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','会议室戴尔笔记本',4,124,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (125,'EMP0125','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','会议室联想笔记本',4,125,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (126,'EMP0126','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','赵颖',4,126,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (127,'EMP0127','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','杜晨阳',4,127,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (128,'EMP0128','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','刘千慧',4,128,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (129,'EMP0129','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','韩洪宇',4,129,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (130,'EMP0130','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','张钰',4,130,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (131,'EMP0131','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','罗文',4,131,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (132,'EMP0132','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','1',4,132,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (133,'EMP0133','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','12',4,133,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (134,'EMP0134','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','员工001',4,134,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (135,'EMP0135','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','员工002',4,135,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (136,'EMP0136','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','员工003',4,136,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (137,'EMP0137','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','员工004',4,137,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (138,'EMP0138','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','员工005',4,138,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (139,'EMP0139','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','员工006',4,139,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (140,'EMP0140','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','员工007',4,140,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (141,'EMP0141','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','员工008',4,141,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');
INSERT INTO `Admin` (`id`,`username`,`password`,`displayName`,`roleId`,`employeeId`,`departmentScope`,`isActive`,`mustChangePassword`,`createdAt`,`updatedAt`) VALUES (142,'EMP0142','$2b$10$0A2yESV59rsCNhnKQ7t3luv/l2JFUK8I.OK/6Tlhu8XTQ2wjQRFrK','王宇轩',4,142,'ALL',1,1,'2026-09-24 13:44:21.280','2026-09-24 13:44:21.280');


/* ---------- 5) AUTO_INCREMENT 修正 ---------- */
ALTER TABLE `Department` AUTO_INCREMENT = 24;
ALTER TABLE `Employee` AUTO_INCREMENT = 143;
ALTER TABLE `AssetCategory` AUTO_INCREMENT = 8;
ALTER TABLE `ComponentCategory` AUTO_INCREMENT = 9;
ALTER TABLE `ComponentModel` AUTO_INCREMENT = 130;
ALTER TABLE `ComponentStock` AUTO_INCREMENT = 130;
ALTER TABLE `ComponentStockLog` AUTO_INCREMENT = 137;
ALTER TABLE `DeviceTemplate` AUTO_INCREMENT = 108;
ALTER TABLE `TemplateComponent` AUTO_INCREMENT = 660;
ALTER TABLE `Asset` AUTO_INCREMENT = 201;
ALTER TABLE `AssetComponent` AUTO_INCREMENT = 825;
ALTER TABLE `LifecycleLog` AUTO_INCREMENT = 243;
ALTER TABLE `StocktakeSession` AUTO_INCREMENT = 2;
ALTER TABLE `StocktakeRecord` AUTO_INCREMENT = 98;
ALTER TABLE `SystemLog` AUTO_INCREMENT = 252;
ALTER TABLE `Admin` AUTO_INCREMENT = 143;

SET FOREIGN_KEY_CHECKS = 1;
/* ========================= 文件结束 ========================= */
