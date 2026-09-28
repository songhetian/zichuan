import {
  Monitor, Cpu, Users, ClipboardList, Bell, ClipboardCheck,
  Settings, FileText, LayoutDashboard, Package, Building2, ShieldCheck, UserCircle, Warehouse,
} from "lucide-react"
import type { LucideIcon } from "lucide-react";

export interface NavChild {
  href: string
  label: string
  /** 访问该菜单所需权限点；缺省/空 → 登录即可见 */
  perm?: string
}

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  perm?: string
  /** 所属分区标题（用于侧边栏分组；缺省归入「工作台」） */
  section?: string
  children?: NavChild[]
}

/** 分区的展示顺序（未列出的 section 追加在后面） */
export const SECTION_ORDER = ["工作台", "业务管理", "协同办公", "系统"] as const;

/**
 * 导航与路由的单一权限来源。
 * 侧边栏裁剪与页面拦截都从这里取，避免两处配置漂移。
 * 菜单上没列出的动态/详情路由，在 EXTRA_ROUTES 里单独声明放行或拦截。
 */
export const navItems: NavItem[] = [
  // ==== 工作台 ====
  { href: "/dashboard", label: "首页", icon: LayoutDashboard, perm: undefined, section: "工作台" },
  { href: "/notifications", label: "通知中心", icon: Bell, perm: undefined, section: "工作台" },

  // ==== 业务管理 ====
  {
    href: "/assets",
    label: "设备管理",
    icon: Monitor,
    section: "业务管理",
    children: [
      { href: "/assets", label: "设备列表", perm: "asset.device.view" },
      { href: "/lifecycle", label: "设备生命周期", perm: "asset.manage" },
      { href: "/templates", label: "设备模板", perm: "asset.template.view" },
      { href: "/settings/asset-categories", label: "设备分类", perm: "asset.category.view" },
    ],
  },
  {
    href: "/components",
    label: "配件管理",
    icon: Cpu,
    section: "业务管理",
    children: [
      { href: "/components/models", label: "配件库存", perm: "asset.component.view" },
      { href: "/components/stock", label: "库存流水", perm: "asset.stockflow.view" },
      { href: "/components/purchase-request", label: "加购配件", perm: "asset.purchase.view" },
      { href: "/components/purchase", label: "采购留痕", perm: "asset.purchase.view" },
      { href: "/settings/component-categories", label: "配件分类", perm: "asset.compcategory.view" },
    ],
  },
  { href: "/stocktake", label: "库存盘点", icon: ClipboardCheck, perm: "asset.stocktake.view", section: "业务管理" },
  { href: "/inventory", label: "库存分析", icon: Warehouse, perm: "asset.manage", section: "业务管理" },
  { href: "/employees", label: "员工管理", icon: Users, perm: "employee.view", section: "业务管理" },
  { href: "/settings/departments", label: "部门管理", icon: Building2, perm: "department.view", section: "业务管理" },

  // ==== 协同办公 ====
  {
    href: "/approvals",
    label: "审批中心",
    icon: ClipboardList,
    section: "协同办公",
    children: [
      { href: "/approvals/new", label: "发起申请", perm: "approval.new.view" },
      { href: "/approvals/my", label: "我的申请", perm: "approval.my.view" },
      { href: "/approvals/todo", label: "我的待办", perm: "approval.todo.view" },
      { href: "/approvals/done", label: "我办理的记录", perm: "approval.done.view" },
      { href: "/approvals/cc", label: "我的抄送", perm: "approval.cc.view" },
      { href: "/approvals/execute", label: "待执行变更", perm: "asset.upgrade.view" },
    ],
  },

  // ==== 系统 ====
  { href: "/logs", label: "系统日志", icon: FileText, perm: "system.account.manage", section: "系统" },
  { href: "/settings/roles", label: "角色权限", icon: ShieldCheck, perm: "system.account.manage", section: "系统" },
  { href: "/settings/account", label: "账号设置", icon: UserCircle, perm: undefined, section: "系统" },
  {
    href: "/settings",
    label: "系统设置",
    icon: Settings,
    section: "系统",
    children: [
      { href: "/settings/workflows", label: "流程配置", perm: "workflow.view" },
      { href: "/settings/labels", label: "标签打印", perm: "asset.label.view" },
    ],
  },
]

/** 不在侧边栏菜单内的路由权限（perm=null 表示登录即可访问） */
export const EXTRA_ROUTES: { prefix: string; perm: string | null }[] = [
  { prefix: "/approvals", perm: null },          // 申请单详情 /approvals/<id> 审批链路相关均可见
  { prefix: "/dashboard", perm: null },
  { prefix: "/notifications", perm: null },
  { prefix: "/settings/account", perm: null },
  { prefix: "/", perm: null },                   // 兜底：其余登录可见
]

/** 解析某路径所需权限点；返回 null/undefined 表示登录即可访问 */
export function resolveRoutePermission(pathname: string): string | null | undefined {
  const rules: { prefix: string; perm: string | null | undefined }[] = []
  for (const it of navItems) {
    if (it.children) {
      for (const c of it.children) rules.push({ prefix: c.href, perm: c.perm })
    } else {
      rules.push({ prefix: it.href, perm: it.perm })
    }
  }
  rules.push(...EXTRA_ROUTES)

  const matched = rules.filter(
    (r) =>
      pathname === r.prefix ||
      (r.prefix !== "/" && pathname.startsWith(r.prefix + "/")) ||
      (r.prefix === "/" && pathname.startsWith("/"))
  )
  if (matched.length === 0) return undefined
  matched.sort((a, b) => b.prefix.length - a.prefix.length)
  return matched[0].perm
}