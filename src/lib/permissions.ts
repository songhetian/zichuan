import { prisma } from "./prisma";
import { getTestPermissionOverride } from "./auth";
import { ActionResult } from "./types";

// ============================================================
// 权限点建模（模块 → 页面 → 操作）
//   - PERMISSION_MODULES：分层目录，驱动角色权限页的树形勾选
//   - PERMISSIONS：由目录派生出的扁平清单（兼容写入与校验）
//   - 语义：
//       * 模块级粗粒度点（如 asset.manage）勾选后自动带出其下所有页面/操作
//       * 页面/操作可逐项单独勾选（父级含子级、逐层可选）
// ============================================================

export interface PermAction {
  key: string;
  label: string;
}

export interface PermPage {
  label: string;
  /** 页面级权限 key（路由访问）；缺省复用模块级 parent
   *  当该页无独立访问细分时 key 可为 parent 本身 */
  key?: string;
  actions?: PermAction[];
}

export interface PermModule {
  module: string; // 模块名（用于分组）
  parentKey: string; // 模块级粗粒度权限 key
  parentLabel: string;
  pages: PermPage[];
}

export const PERMISSION_MODULES: PermModule[] = [
  {
    module: "资产与库存",
    parentKey: "asset.manage",
    parentLabel: "资产与库存管理",
    pages: [
      {
        label: "设备列表",
        key: "asset.device.view",
        actions: [
          { key: "asset.device.create", label: "新增设备" },
          { key: "asset.device.update", label: "编辑设备" },
          { key: "asset.device.delete", label: "删除设备" },
          { key: "asset.device.export", label: "导出设备" },
        ],
      },
      {
        label: "设备模板",
        key: "asset.template.view",
        actions: [
          { key: "asset.template.create", label: "新建模板" },
          { key: "asset.template.update", label: "编辑模板" },
          { key: "asset.template.delete", label: "删除模板" },
        ],
      },
      {
        label: "批量入库",
        key: "asset.import.view",
        actions: [{ key: "asset.import.execute", label: "执行导入" }],
      },
      {
        label: "配件库存",
        key: "asset.component.view",
        actions: [
          { key: "asset.component.create", label: "新增配件" },
          { key: "asset.component.update", label: "编辑配件" },
          { key: "asset.component.delete", label: "删除配件" },
        ],
      },
      {
        label: "库存流水",
        key: "asset.stockflow.view",
      },
      {
        label: "库存盘点",
        key: "asset.stocktake.view",
        actions: [
          { key: "asset.stocktake.start", label: "发起盘点" },
          { key: "asset.stocktake.commit", label: "确认盘点" },
        ],
      },
      {
        label: "待执行变更",
        key: "asset.upgrade.view",
        actions: [
          { key: "asset.upgrade.execute", label: "执行变更" },
          { key: "asset.replace.execute", label: "执行更换" },
          { key: "asset.repair.execute", label: "执行维修" },
        ],
      },
      {
        label: "设备分类",
        key: "asset.category.view",
        actions: [
          { key: "asset.category.create", label: "新增分类" },
          { key: "asset.category.update", label: "编辑分类" },
          { key: "asset.category.delete", label: "删除分类" },
        ],
      },
      {
        label: "配件分类",
        key: "asset.compcategory.view",
        actions: [
          { key: "asset.compcategory.create", label: "新增分类" },
          { key: "asset.compcategory.update", label: "编辑分类" },
          { key: "asset.compcategory.delete", label: "删除分类" },
        ],
      },
      {
        label: "标签打印",
        key: "asset.label.view",
        actions: [{ key: "asset.label.print", label: "打印标签" }],
      },
    ],
  },
  {
    module: "审批-提交",
    parentKey: "approval.submit",
    parentLabel: "提交审批申请",
    pages: [
      { label: "发起申请", key: "approval.new.view" },
      { label: "我的申请", key: "approval.my.view" },
    ],
  },
  {
    module: "审批-处理",
    parentKey: "approval.approve",
    parentLabel: "审批操作",
    pages: [
      {
        label: "我的待办",
        key: "approval.todo.view",
        actions: [
          { key: "approval.todo.approve", label: "审批通过" },
          { key: "approval.todo.reject", label: "驳回" },
        ],
      },
      { label: "申请单详情", key: "approval.detail.view" },
    ],
  },
  {
    module: "员工与账号",
    parentKey: "system.account.manage",
    parentLabel: "账号与权限管理",
    pages: [
      {
        label: "员工管理",
        key: "employee.view",
        actions: [
          { key: "employee.create", label: "新增员工" },
          { key: "employee.update", label: "编辑员工" },
          { key: "employee.delete", label: "删除员工" },
          { key: "employee.import", label: "导入员工" },
        ],
      },
      {
        label: "用户管理",
        key: "user.view",
        actions: [
          { key: "user.create", label: "新增用户" },
          { key: "user.update", label: "编辑用户" },
          { key: "user.delete", label: "删除用户" },
          { key: "user.resetpwd", label: "重置密码" },
        ],
      },
      { label: "角色权限", key: "role.view" },
      {
        label: "部门管理",
        key: "department.view",
        actions: [
          { key: "department.create", label: "新增部门" },
          { key: "department.update", label: "编辑部门" },
          { key: "department.delete", label: "删除部门" },
        ],
      },
    ],
  },
  {
    module: "审批流程",
    parentKey: "workflow.config.manage",
    parentLabel: "审批流程配置",
    pages: [
      {
        label: "流程配置",
        key: "workflow.view",
        actions: [
          { key: "workflow.create", label: "新建模板" },
          { key: "workflow.update", label: "编辑模板" },
          { key: "workflow.delete", label: "删除模板" },
          { key: "workflow.version", label: "版本切换" },
        ],
      },
    ],
  },
  {
    // 纯数据范围点：无页面/操作细分，作为单独勾选项保留
    module: "数据范围",
    parentKey: "dept.data.view",
    parentLabel: "本部门数据可见",
    pages: [],
  },
  {
    // 离职交接：终审通过后生成对账单，资产管理员核对无误后自动回收
    module: "离职交接",
    parentKey: "asset.depart.view",
    parentLabel: "离职交接管理",
    pages: [
      {
        label: "交接对账",
        key: "asset.depart.handover.view",
        actions: [{ key: "asset.depart.execute", label: "对账确认回收" }],
      },
    ],
  },
  {
    module: "数据范围",
    parentKey: "asset.view.own",
    parentLabel: "查看本人资产与申请单",
    pages: [],
  },
];

// ============================================================
// 派生：扁平权限清单 + 工具
// ============================================================

export interface FlatPerm {
  key: string;
  module: string;
  name: string;
  page?: string; // 所属页面名（页面/操作级才有）
  parent?: string; // 页面/操作级所属的父权限 key
}

const _flat: FlatPerm[] = [];
const _expandMap = new Map<string, string[]>(); // 父 key → 所有后代 key（含父自身）

for (const m of PERMISSION_MODULES) {
  _flat.push({ key: m.parentKey, module: m.module, name: m.parentLabel });
  const descendants: string[] = [m.parentKey];
  for (const p of m.pages) {
    const pageKey = p.key ?? m.parentKey;
    if (pageKey !== m.parentKey) {
      _flat.push({ key: pageKey, module: m.module, name: p.label, page: p.label, parent: m.parentKey });
    }
    const pageDesc: string[] = [pageKey];
    for (const a of p.actions ?? []) {
      _flat.push({ key: a.key, module: m.module, name: a.label, page: p.label, parent: pageKey });
      pageDesc.push(a.key);
    }
    descendants.push(...pageDesc.filter((k) => k !== m.parentKey));
  }
  _expandMap.set(m.parentKey, Array.from(new Set(descendants)));
}

/** 扁平权限清单（含模块/页面/操作全部权限点） */
export const PERMISSIONS: readonly FlatPerm[] = _flat;

/** 全部权限 key（用于校验） */
export const ALL_PERMISSION_KEYS: readonly string[] = _flat.map((f) => f.key);

/** 权限 key → 展示名（优先操作级，其次页面级，最后模块级） */
export function permissionLabel(key: string): string {
  return _flat.find((f) => f.key === key)?.name ?? key;
}

/**
 * 将一组权限 key 展开为“有效权限”集合：
 * 含任意模块级点，则自动带上其所有页面/操作后代（父级含子级）。
 */
export function expandEffective(keys: string[] | readonly string[]): Set<string> {
  const out = new Set<string>(keys);
  for (const k of keys) {
    const desc = _expandMap.get(k);
    if (desc) for (const d of desc) out.add(d);
  }
  return out;
}

export type PermissionKey = string;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_KEYS = [
  "SUPER_ADMIN",
  "ASSET_MANAGER",
  "DEPT_MANAGER",
  "EMPLOYEE",
] as const;

/**
 * 默认角色 → 权限点矩阵。
 * 可直接引用模块级点（保存/读取时会自动展开为页面/操作级）。
 */
export const ROLE_PERMISSION_MATRIX: Record<RoleKey, readonly PermissionKey[]> = {
  SUPER_ADMIN: ALL_PERMISSION_KEYS,
  ASSET_MANAGER: [
    "asset.manage",
    "dept.data.view",
    "approval.submit",
    "approval.approve",
    "asset.view.own",
    "asset.depart.view",
  ],
  DEPT_MANAGER: [
    "dept.data.view",
    "approval.submit",
    "approval.approve",
    "asset.view.own",
    // 部门主管需查看所属员工的设备列表（发起/审批需选定设备）
    "asset.device.view",
  ],
  EMPLOYEE: [
    "approval.submit",
    "asset.view.own",
    // 员工需查看本人名下设备以发起升级/降级申请
    "asset.device.view",
  ],
};

// ============================================================
// 权限判定
// ============================================================

/**
 * 权限判定（纯函数 seam）。required 为单个 key；调用方通常传入“已展开的有效集合”。
 */
export function can(
  permissionKeys: string[] | null | undefined,
  required: string
): boolean {
  return !!permissionKeys && permissionKeys.includes(required);
}

/** 当前登录账号是否拥有某权限（无角色/无该权限一律 false） */
export async function hasPermission(
  user: { id: number },
  required: string
): Promise<boolean> {
  // 测试注入的显式权限优先
  const override = getTestPermissionOverride(user.id);
  if (override !== undefined) {
    return can(Array.from(expandEffective(override)), required);
  }

  const admin = await prisma.admin.findUnique({
    where: { id: user.id },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });
  if (!admin?.role) return false;
  const effective = expandEffective(admin.role.permissions.map((rp) => rp.permission.key));
  return can([...effective], required);
}

/**
 * 权限守卫：认证通过但缺少权限时返回失败结果（供写操作在 requireAuth 后调用）。
 * 返回 null 表示放行。
 */
export async function guardPermission<T = never>(
  user: { id: number },
  required: string,
  errorMessage = "没有该操作的权限"
): Promise<ActionResult<T> | null> {
  if (!(await hasPermission(user, required))) {
    return { success: false, error: errorMessage };
  }
  return null;
}

/**
 * 解析账号角色的显式部门数据范围：
 * - 拥有 system.account.manage（超管/账号管理）→ 'ALL'（不限，含全部资产与部门）
 * - 角色 departmentScope='SPEC' → 该角色关联的部门 id 列表（仅限这些部门的资产/人员）
 * - 否则 → 'ALL'（沿用权限矩阵默认范围：asset.manage 全部 / dept.data.view 主管部门）
 */
export async function resolveRoleDepartmentScope(
  user: { id: number }
): Promise<"ALL" | number[]> {
  if (await hasPermission(user, "system.account.manage")) return "ALL";
  const admin = await prisma.admin.findUnique({
    where: { id: user.id },
    include: { role: { include: { departments: { select: { departmentId: true } } } } },
  });
  if (!admin?.role || admin.role.departmentScope !== "SPEC") return "ALL";
  return admin.role.departments.map((d) => d.departmentId);
}