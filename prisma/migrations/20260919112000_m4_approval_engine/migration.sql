-- CreateTable
CREATE TABLE `ApprovalRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestNo` VARCHAR(191) NOT NULL,
    `definitionId` INTEGER NOT NULL,
    `businessType` ENUM('ASSET_UPGRADE') NOT NULL,
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

    UNIQUE INDEX `ApprovalRequest_requestNo_key`(`requestNo`),
    INDEX `ApprovalRequest_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `ApprovalRequest_initiatorId_status_idx`(`initiatorId`, `status`),
    INDEX `ApprovalRequest_businessType_status_idx`(`businessType`, `status`),
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
ALTER TABLE `ApprovalRequest` ADD CONSTRAINT `ApprovalRequest_definitionId_fkey` FOREIGN KEY (`definitionId`) REFERENCES `WorkflowDefinition`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalRequest` ADD CONSTRAINT `ApprovalRequest_currentNodeId_fkey` FOREIGN KEY (`currentNodeId`) REFERENCES `WorkflowNode`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalRequest` ADD CONSTRAINT `ApprovalRequest_initiatorId_fkey` FOREIGN KEY (`initiatorId`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalTask` ADD CONSTRAINT `ApprovalTask_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalTask` ADD CONSTRAINT `ApprovalTask_nodeId_fkey` FOREIGN KEY (`nodeId`) REFERENCES `WorkflowNode`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalTask` ADD CONSTRAINT `ApprovalTask_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `Admin`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalLog` ADD CONSTRAINT `ApprovalLog_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `ApprovalRequest`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ApprovalLog` ADD CONSTRAINT `ApprovalLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `Admin`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
