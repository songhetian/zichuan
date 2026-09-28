-- 「我办理的记录」权限点：approval.done.view（页面）
INSERT INTO `Permission` (`key`, `module`, `name`) VALUES
  ('approval.done.view', '审批-处理', '我办理的记录'),
  ('approval.done.export', '审批-处理', '导出记录')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `name` = VALUES(`name`);

-- 存量角色补授权：已持有「我的待办」(approval.todo.view) 的角色，一并授予新页面与其导出动作点
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT rp.`roleId`, p.`id`
FROM `RolePermission` rp
JOIN `Permission` src ON src.`id` = rp.`permissionId` AND src.`key` = 'approval.todo.view'
JOIN `Permission` p ON p.`key` IN ('approval.done.view', 'approval.done.export');

-- 超级管理员（系统角色）：补授新增的全部权限点
INSERT IGNORE INTO `RolePermission` (`roleId`, `permissionId`)
SELECT r.`id`, p.`id`
FROM `Role` r
JOIN `Permission` p ON p.`key` IN ('approval.done.view', 'approval.done.export')
WHERE r.`key` = 'SUPER_ADMIN';