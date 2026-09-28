"use client";

import { useEffect, useState, type DragEvent } from "react";
import {
  TrendingUp, Trash2, Undo2, RefreshCw, Wrench, LogOut, ShoppingCart, type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  getWorkflowDefinitions,
  getWorkflowDefinition,
  getWorkflowConfigSummary,
  createWorkflowDefinition,
  addWorkflowNode,
  updateWorkflowNode,
  removeWorkflowNode,
  duplicateWorkflowNode,
  reorderWorkflowNodes,
  publishWorkflowDefinition,
  duplicateWorkflowDefinition,
  removeWorkflowDraft,
  activateWorkflowVersion,
  type WorkflowNodeInput,
} from "@/actions/workflow.actions";

type DefinitionRow = {
  id: number;
  name: string;
  version: number;
  status: string;
  publishedAt: string | null;
  nodeCount: number;
};

type NodeRow = {
  id: number;
  nodeKey: string;
  name: string;
  sortOrder: number;
  assigneeType: string;
  assigneeUserId: number | null;
  assigneeRole: string | null;
  initiatorCanChoose: boolean;
  multiMode: string;
  ccType: string;
  ccUserIds: number[] | null;
  ccRules: unknown;
};

type CcRule = {
  type: string;
  roleKey?: string;
  userIds?: number[];
};

type Detail = {
  id: number;
  name: string;
  businessType: string;
  version: number;
  status: string;
  publishedAt: string | null;
  nodes: NodeRow[];
};

const STATUS_BADGE: Record<string, { label: string; variant: "secondary" | "default" | "outline" }> = {
  DRAFT: { label: "草稿", variant: "secondary" },
  PUBLISHED: { label: "生效", variant: "default" },
  ARCHIVED: { label: "已归档", variant: "outline" },
};

const ASSIGNEE_LABEL: Record<string, string> = {
  DEPT_MANAGER: "部门主管",
  EMP_MANAGER: "直属主管",
  ROLE: "按角色",
  USER: "指定账号",
  INITIATOR: "发起人",
  CUSTOM: "发起人自选",
};

const CC_LABEL: Record<string, string> = {
  NONE: "不抄送",
  INITIATOR: "发起人本人",
  DEPT_MANAGER: "部门主管",
  EMP_MANAGER: "直属主管",
  SPECIFIC: "指定人",
};

const MULTI_LABEL: Record<string, string> = {
  ANY: "或签（任一通过）",
  ALL: "会签（全部通过）",
};

const ROLE_OPTIONS = [
  { value: "SUPER_ADMIN", label: "超级管理员" },
  { value: "ASSET_MANAGER", label: "资产管理员" },
  { value: "DEPT_MANAGER", label: "部门主管" },
  { value: "EMPLOYEE", label: "普通员工" },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label])
);

export type WorkflowBusinessType =
  | "ASSET_UPGRADE"
  | "ASSET_SCRAP"
  | "ASSET_RETURN"
  | "ASSET_REPLACE"
  | "ASSET_REPAIR"
  | "ASSET_DEPART"
  | "ASSET_PURCHASE";

const BIZ_TABS: {
  key: WorkflowBusinessType;
  label: string;
  icon: LucideIcon;
  /** 终审通过后的落地方式：auto 自动 / manual 手动（待执行变更） / handover 交接对账 */
  exec: "auto" | "manual" | "handover";
  desc: string;
}[] = [
  { key: "ASSET_UPGRADE", label: "升级配件", icon: TrendingUp, exec: "manual", desc: "升级/降级配件，审批后由资产管理员执行" },
  { key: "ASSET_SCRAP", label: "资产报废", icon: Trash2, exec: "auto", desc: "审批通过后自动执行报废落地" },
  { key: "ASSET_RETURN", label: "设备退回", icon: Undo2, exec: "auto", desc: "审批通过后自动置闲置归还" },
  { key: "ASSET_REPLACE", label: "更换设备", icon: RefreshCw, exec: "manual", desc: "审批后由资产管理员回收旧机并分配新机" },
  { key: "ASSET_REPAIR", label: "设备维修", icon: Wrench, exec: "manual", desc: "审批后由资产管理员置维修并分配替换机" },
  { key: "ASSET_DEPART", label: "员工离职", icon: LogOut, exec: "handover", desc: "审批后生成交接单，对账无误后回收设备" },
  { key: "ASSET_PURCHASE", label: "加购配件", icon: ShoppingCart, exec: "auto", desc: "审批通过后自动入库并写采购留痕" },
];

const EXEC_META: Record<"auto" | "manual" | "handover", { label: string; cls: string }> = {
  auto: { label: "自动落地", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30" },
  manual: { label: "手动执行", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/30" },
  handover: { label: "交接对账", cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/30" },
};

/** 每种执行方式的强调色（图标底座 / 左侧竖条 / 标题高亮） */
const EXEC_ACCENT: Record<"auto" | "manual" | "handover", string> = {
  auto: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:bg-emerald-500/15",
  manual: "bg-amber-500/10 text-amber-600 dark:text-amber-400 group-hover:bg-amber-500/15",
  handover: "bg-sky-500/10 text-sky-600 dark:text-sky-400 group-hover:bg-sky-500/15",
};
/** 每种执行方式的左侧竖条颜色 */
const EXEC_BAR: Record<"auto" | "manual" | "handover", string> = {
  auto: "bg-emerald-500",
  manual: "bg-amber-500",
  handover: "bg-sky-500",
};

type NodeFormState = {
  mode: "add" | "edit";
  nodeId?: number;
  name: string;
  assigneeType: string;
  assigneeRole: string;
  multiMode: string;
  ccType: string;
  ccRules: CcRule[];
};

const emptyForm = (): NodeFormState => ({
  mode: "add",
  name: "",
  assigneeType: "DEPT_MANAGER",
  assigneeRole: "ASSET_MANAGER",
  multiMode: "ANY",
  ccType: "NONE",
  ccRules: [],
});

const CC_RULE_TYPES = ["INITIATOR", "DEPT_MANAGER", "EMP_MANAGER", "ROLE", "USER"] as const;

const CC_RULE_LABEL: Record<(typeof CC_RULE_TYPES)[number], string> = {
  INITIATOR: "发起人本人",
  DEPT_MANAGER: "部门主管",
  EMP_MANAGER: "直属主管",
  ROLE: "按角色",
  USER: "指定账号",
};

export function WorkflowsClient({
  initialDefinitions,
}: {
  initialDefinitions: DefinitionRow[];
}) {
  const [definitions, setDefinitions] = useState(initialDefinitions);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<WorkflowBusinessType>("ASSET_UPGRADE");
  const [configSummary, setConfigSummary] = useState<
    Record<WorkflowBusinessType, { total: number; published: number }> | undefined
  >(undefined);
  const [nodeForm, setNodeForm] = useState<NodeFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragNodeId, setDragNodeId] = useState<number | null>(null);
  const [dragOverNodeId, setDragOverNodeId] = useState<number | null>(null);
  const [confirmDel, setConfirmDel] = useState<
    | { kind: "draft"; id: number; label: string }
    | { kind: "node"; id: number; label: string }
    | null
  >(null);
  const [bizType, setBizType] = useState<WorkflowBusinessType>("ASSET_UPGRADE");
  /** 视图：overview 总览 / detail 某类型版本详情 */
  const [view, setView] = useState<"overview" | "detail">("overview");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const { toast } = useToast();

  /** 挂载时拉取各业务类型的配置汇总（总览卡依赖） */
  useEffect(() => {
    (async () => {
      const [s, defs] = await Promise.all([
        getWorkflowConfigSummary(),
        getWorkflowDefinitions("ASSET_UPGRADE"),
      ]);
      if (s.success) setConfigSummary(s.data as Record<WorkflowBusinessType, { total: number; published: number }>);
      if (defs.success) {
        setDefinitions(
          defs.data.map((d) => ({
            ...d,
            publishedAt:
              d.publishedAt instanceof Date ? d.publishedAt.toISOString() : d.publishedAt,
          }))
        );
      }
      setSummaryLoading(false);
    })();
  }, []);

  const refreshList = async () => {
    try {
      const result = await getWorkflowDefinitions(bizType);
      if (result.success) {
        setDefinitions(
          result.data.map((d) => ({
            ...d,
            publishedAt:
              d.publishedAt instanceof Date ? d.publishedAt.toISOString() : d.publishedAt,
          }))
        );
      }
    } catch {
      toast({ title: "加载失败", description: "加载异常，请稍后重试", variant: "destructive" });
    }
  };

  /** 切换业务类型：清空选择并重新加载对应流程列表，进入该类型详情视图 */
  const switchBizType = async (next: WorkflowBusinessType) => {
    if (next === bizType) {
      setView("detail");
      return;
    }
    setBizType(next);
    setSelectedId(null);
    setDetail(null);
    setDetailLoading(false);
    setView("detail");
    try {
      const result = await getWorkflowDefinitions(next);
      if (result.success) {
        setDefinitions(
          result.data.map((d) => ({
            ...d,
            publishedAt:
              d.publishedAt instanceof Date ? d.publishedAt.toISOString() : d.publishedAt,
          }))
        );
      }
    } catch {
      toast({ title: "加载失败", description: "加载异常，请稍后重试", variant: "destructive" });
    }
  };

  /** 返回总览：回到 7 类状态卡 */
  const backToOverview = () => {
    setView("overview");
    setSelectedId(null);
    setDetail(null);
    setDetailLoading(false);
  };

  const openDetail = async (id: number) => {
    setSelectedId(id);
    // 先弹出弹窗，再后台加载详情，避免点击后等待接口造成“卡顿感”
    setDetailLoading(true);
    setDetail(null);
    try {
      const result = await getWorkflowDefinition(id);
      if (result.success) {
        setDetail(result.data as unknown as Detail);
      } else {
        toast({ title: "加载失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "加载失败", description: "加载异常，请稍后重试", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedId(null);
    setDetail(null);
    setDetailLoading(false);
  };

  const openCreate = async () => {
    setCreateType(bizType);
    setCreateName("");
    setShowCreate(true);
    try {
      const result = await getWorkflowConfigSummary();
      if (result.success) setConfigSummary(result.data);
    } catch {
      toast({ title: "加载失败", description: "加载异常，请稍后重试", variant: "destructive" });
    }
  };

  const handleCreate = async () => {
    if (!createName.trim()) {
      toast({ title: "请输入流程名称", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const result = await createWorkflowDefinition({
        businessType: createType,
        name: createName.trim(),
        nodes: [
          {
            name: "部门主管审批",
            assigneeType: "DEPT_MANAGER",
            ccType: "INITIATOR",
          },
        ],
      });
      if (result.success) {
        toast({ title: "创建成功" });
        setShowCreate(false);
        setCreateName("");
        await refreshList();
      } else {
        toast({ title: "创建失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const openAddNode = () => setNodeForm(emptyForm());

  const openEditNode = (node: NodeRow) => {
    setNodeForm({
      mode: "edit",
      nodeId: node.id,
      name: node.name,
      assigneeType: node.assigneeType,
      assigneeRole: node.assigneeRole ?? "ASSET_MANAGER",
      multiMode: node.multiMode,
      ccType: "NONE",
      ccRules: migrateCcToRules(node.ccRules, node.ccType, node.ccUserIds),
    });
  };

  /** 把历史单值抄送(ccType/ccUserIds)迁移为 ccRules；已有 ccRules 时优先保留 */
  const migrateCcToRules = (
    rawRules: unknown,
    ccType: string,
    ccUserIds: number[] | null
  ): CcRule[] => {
    const rules = normalizeCcRules(rawRules);
    if (rules.length > 0) return rules;
    if (ccType === "NONE") return [];
    if (ccType === "INITIATOR") return [{ type: "INITIATOR" }];
    if (ccType === "DEPT_MANAGER") return [{ type: "DEPT_MANAGER" }];
    if (ccType === "EMP_MANAGER") return [{ type: "EMP_MANAGER" }];
    if (ccType === "SPECIFIC" && ccUserIds?.length) {
      return [{ type: "USER", userIds: ccUserIds }];
    }
    return [];
  };

  /** 兼容 Json 列读回（可能是 string），过滤无效规则 */
  const normalizeCcRules = (raw: unknown): CcRule[] => {
    if (typeof raw === "string") {
      try {
        return normalizeCcRules(JSON.parse(raw));
      } catch {
        return [];
      }
    }
    if (!Array.isArray(raw)) return [];
    return (raw as CcRule[]).filter((r) => CC_RULE_TYPES.includes(r.type as never));
  };

  const updateRule = (index: number, patch: Partial<CcRule>) => {
    if (!nodeForm) return;
    const next = nodeForm.ccRules.map((r, i) => (i === index ? { ...r, ...patch } : r));
    setNodeForm({ ...nodeForm, ccRules: next });
  };

  const removeRule = (index: number) => {
    if (!nodeForm) return;
    setNodeForm({
      ...nodeForm,
      ccRules: nodeForm.ccRules.filter((_, i) => i !== index),
    });
  };

  const addRule = () => {
    if (!nodeForm) return;
    setNodeForm({ ...nodeForm, ccRules: [...nodeForm.ccRules, { type: "INITIATOR" }] });
  };

  const handleSaveNode = async () => {
    if (!nodeForm || !selectedId) return;
    if (!nodeForm.name.trim()) {
      toast({ title: "请输入节点名称", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: WorkflowNodeInput = {
      name: nodeForm.name.trim(),
      assigneeType: nodeForm.assigneeType as WorkflowNodeInput["assigneeType"],
      assigneeRole:
        nodeForm.assigneeType === "ROLE"
          ? nodeForm.assigneeRole
          : undefined,
      multiMode: nodeForm.multiMode as WorkflowNodeInput["multiMode"],
      ccType: "NONE",
      ccRules: nodeForm.ccRules.map((r) =>
        r.type === "USER" && r.userIds?.length
          ? { type: r.type, userIds: r.userIds }
          : r.type === "ROLE"
            ? { type: r.type, roleKey: r.roleKey ?? "" }
            : { type: r.type }
      ) as WorkflowNodeInput["ccRules"],
    };
    try {
      const result =
        nodeForm.mode === "add"
          ? await addWorkflowNode(selectedId, payload)
          : await updateWorkflowNode(nodeForm.nodeId!, payload);
      if (result.success) {
        toast({ title: nodeForm.mode === "add" ? "节点已添加" : "节点已更新" });
        setNodeForm(null);
        await openDetail(selectedId);
      } else {
        toast({ title: "保存失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveNode = async (nodeId: number) => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const result = await removeWorkflowNode(nodeId);
      if (result.success) {
        toast({ title: "节点已删除" });
        await openDetail(selectedId);
      } else {
        toast({ title: "删除失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicateNode = async (nodeId: number) => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const result = await duplicateWorkflowNode(nodeId);
      if (result.success) {
        toast({ title: "节点已复制" });
        await openDetail(selectedId);
      } else {
        toast({ title: "复制失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /** 提交一次新的节点顺序（供上移/下移与拖拽复用） */
  const commitOrder = async (definitionId: number, ids: number[]) => {
    try {
      const result = await reorderWorkflowNodes(definitionId, ids);
      if (result.success) {
        await openDetail(definitionId);
      } else {
        toast({ title: "调整失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    }
  };

  const handleMoveNode = async (node: NodeRow, dir: -1 | 1) => {
    if (!detail) return;
    const index = detail.nodes.findIndex((n) => n.id === node.id);
    const target = index + dir;
    if (target < 0 || target >= detail.nodes.length) return;
    const ids = detail.nodes.map((n) => n.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await commitOrder(detail.id, ids);
  };

  const handleDragStart = (id: number) => {
    setDragNodeId(id);
    setDragOverNodeId(null);
  };

  /** 拖拽悬停在节点卡片上：标记为目标，供 drop 插入 */
  const handleDragOver = (id: number) => (e: DragEvent) => {
    if (!editable) return;
    e.preventDefault();
    if (dragNodeId !== id) setDragOverNodeId(id);
  };

  /** 拖拽离开节点卡片：若目标已移出卡片则清除高亮（容忍在子元素间移动） */
  const handleDragLeave = (id: number) => (e: DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDragOverNodeId((cur) => (cur === id ? null : cur));
  };

  /** 拖拽结束：无论成功与否都清理拖拽状态 */
  const handleDragEnd = () => {
    setDragNodeId(null);
    setDragOverNodeId(null);
  };

  const handleDrop = async (targetId: number) => {
    setDragNodeId(null);
    setDragOverNodeId(null);
    if (!detail || dragNodeId == null || dragNodeId === targetId) return;
    const ids = detail.nodes.map((n) => n.id);
    const from = ids.indexOf(dragNodeId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragNodeId);
    await commitOrder(detail.id, ids);
  };

  const handlePublish = async (id: number) => {
    setSaving(true);
    try {
      const result = await publishWorkflowDefinition(id);
      if (result.success) {
        toast({ title: "已发布，成为当前生效版本" });
        await refreshList();
        if (selectedId === id) await openDetail(id);
      } else {
        toast({ title: "发布失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /** 一键复制为新版草稿（已发布/已归档版本由此获得「可管理」能力） */
  const handleDuplicate = async (id: number, openAfter = true) => {
    setSaving(true);
    try {
      const result = await duplicateWorkflowDefinition(id);
      if (result.success) {
        toast({
          title: "已复制为新版本",
          description: `基于 v${definitions.find((d) => d.id === id)?.version ?? ""} 新建草稿 v${result.data.version}`,
        });
        await refreshList();
        if (openAfter) await openDetail(result.data.id);
      } else {
        toast({ title: "复制失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /** 历史版本一键设为当前生效 */
  const handleActivate = async (id: number) => {
    setSaving(true);
    try {
      const result = await activateWorkflowVersion(id);
      if (result.success) {
        toast({ title: "已设为当前生效", description: `v${result.data.version} 已切换为生效版本` });
        await refreshList();
        if (selectedId === id) await openDetail(id);
      } else {
        toast({ title: "设置失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /** 删除流程版本 */
  const handleRemoveDraft = async (id: number) => {
    setSaving(true);
    try {
      const result = await removeWorkflowDraft(id);
      if (result.success) {
        toast({ title: "流程版本已删除" });
        if (selectedId === id) {
          setSelectedId(null);
          setDetail(null);
          setDetailLoading(false);
        }
        await refreshList();
      } else {
        toast({ title: "删除失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "操作失败", description: "操作异常，请稍后重试", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  /** 已确认删除：按 kind 分发到草稿/节点删除 */
  const confirmDelete = async () => {
    if (!confirmDel) return;
    const target = confirmDel;
    setConfirmDel(null);
    if (target.kind === "draft") await handleRemoveDraft(target.id);
    else await handleRemoveNode(target.id);
  };

  const selected = definitions.find((d) => d.id === selectedId);
  const editable = !!detail;

  return (
    <div className="space-y-6">
      <PageHeader
        title="流程配置"
        description="编排审批流程版本与节点；未删除的版本（草稿/生效/归档）均可原地编辑"
      />

      {/* 总览：7 类业务类型的配置状态卡 */}
      {view === "overview" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
          {BIZ_TABS.map((tab) => {
            const s = configSummary?.[tab.key];
            const total = s?.total ?? 0;
            const published = s?.published ?? 0;
            const missing = total === 0;
            const Icon = tab.icon;
            const tone = missing
              ? ""
              : published > 0
                ? "bg-card border-border hover:border-primary/40"
                : "border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5";
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => switchBizType(tab.key)}
                className={`group relative flex flex-col items-stretch gap-3 overflow-hidden rounded-xl border p-4 pl-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${
                  missing
                    ? "border-red-200 bg-red-50/50 dark:border-red-500/30 dark:bg-red-500/5"
                    : tone
                }`}
              >
                {/* 左侧执行方式色条 */}
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 w-1 ${EXEC_BAR[tab.exec]} ${
                    missing ? "opacity-40" : ""
                  }`}
                />
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                        missing
                          ? "bg-red-500/10 text-red-600 dark:text-red-400"
                          : EXEC_ACCENT[tab.exec]
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px] stroke-[1.8]" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{tab.label}</p>
                      <span
                        className={`mt-0.5 inline-flex items-center rounded-full border px-1.5 py-px text-[11px] font-normal ${EXEC_META[tab.exec].cls}`}
                      >
                        {EXEC_META[tab.exec].label}
                      </span>
                    </div>
                  </div>
                  {/* 右下箭头提示可点 */}
                  <span className="mt-0.5 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground">→</span>
                </div>
                <div className="w-full">
                  {summaryLoading ? (
                    <div className="flex h-9 items-center">
                      <span className="text-sm text-muted-foreground">加载中…</span>
                    </div>
                  ) : missing ? (
                    <div>
                      <p className="flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
                        <span className="text-lg leading-none">!</span> 未配置流程
                      </p>
                      <p className="mt-0.5 text-xs text-red-600/70 dark:text-red-400/70">
                        发起该类型申请会失败
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="flex items-baseline gap-1 font-display text-2xl font-semibold leading-none text-foreground">
                          {published}
                          <span className="text-sm font-normal text-muted-foreground">个生效</span>
                        </p>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          共 {total} 个版本
                          {published === 0 ? " · 无主生效版本" : ""}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground/90">
                  {tab.desc}
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* 版本轨道 */}
      {view === "detail" && (
      <Card className={selected ? undefined : undefined}>
        <CardHeader>
          {/* 面包屑 + 当前类型执行徽标 */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <nav className="flex items-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={backToOverview}
                className="transition-colors hover:text-foreground"
              >
                流程配置
              </button>
              <span className="mx-2 text-muted-foreground/60">/</span>
              <span className="font-medium text-foreground">
                {BIZ_TABS.find((t) => t.key === bizType)?.label}
              </span>
            </nav>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-normal ${EXEC_META[BIZ_TABS.find((t) => t.key === bizType)?.exec ?? "manual"].cls}`}
            >
              {EXEC_META[BIZ_TABS.find((t) => t.key === bizType)?.exec ?? "manual"].label}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {BIZ_TABS.find((t) => t.key === bizType)?.label} · 流程版本
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" onClick={openCreate}>
                新建版本
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {definitions.map((d) => {
              const isSelected = d.id === selectedId;
              return (
                <div
                  key={d.id}
                  onClick={() => openDetail(d.id)}
                  className={`flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/40 ${
                    d.status === "PUBLISHED" ? "border-primary/40 bg-primary/[0.04]" : ""
                  } ${isSelected ? "ring-1 ring-primary/40" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-display text-xs font-semibold ${
                        d.status === "PUBLISHED"
                          ? "bg-primary text-primary-foreground"
                          : d.status === "DRAFT"
                            ? "border border-border bg-secondary/60 text-muted-foreground"
                            : "border border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      v{d.version}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">{d.name}</p>
                        <Badge variant={STATUS_BADGE[d.status]?.variant ?? "secondary"}>
                          {STATUS_BADGE[d.status]?.label ?? d.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                        <span>{d.nodeCount}</span>
                        {d.publishedAt
                          ? ` · ${new Date(d.publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {d.status === "ARCHIVED" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
                        title="设为当前生效"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleActivate(d.id);
                        }}
                        disabled={saving}
                      >
                        设为当前生效
                      </Button>
                    )}
                    {d.status === "DRAFT" && (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        title="发布"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePublish(d.id);
                        }}
                        disabled={saving}
                      >
                        发布
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      title="删除该版本"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDel({ kind: "draft", id: d.id, label: d.name });
                      }}
                      disabled={saving || definitions.length <= 1}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              );
            })}
            {definitions.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                暂无流程版本，点击「新建版本」创建
              </p>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {/* 节点顺序链配置区（居中弹窗内编辑） */}
      <Dialog
        open={selectedId !== null && selected !== undefined}
        onOpenChange={(v) => {
          if (!v && !saving) closeDetail();
        }}
      >
        <DialogContent className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
              <span className="font-display text-sm font-semibold text-primary">
                v{detail?.version}
              </span>
              <span className="truncate">{detail?.name}</span>
              {detail && (
                <Badge variant={STATUS_BADGE[detail.status]?.variant ?? "secondary"}>
                  {STATUS_BADGE[detail.status]?.label ?? detail.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {detailLoading ? (
              <p className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground">
                加载中…
              </p>
            ) : !detail || !selected ? (
              <p className="flex h-full min-h-[240px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                流程加载失败，请关闭后重试。
              </p>
            ) : (
              <>
                <div className="divide-y divide-border/70 overflow-hidden rounded-lg border bg-card">
                  {detail.nodes.map((node, index) => {
                    return (
                    <div key={node.id} className="relative">
                      <div
                        draggable={editable}
                        onDragStart={() => editable && handleDragStart(node.id)}
                        onDragOver={handleDragOver(node.id)}
                        onDragLeave={handleDragLeave(node.id)}
                        onDrop={() => editable && handleDrop(node.id)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40 ${
                          editable && dragNodeId === node.id
                            ? "bg-primary/5 opacity-60"
                            : editable && dragOverNodeId === node.id
                              ? "cursor-grab bg-primary/5"
                              : editable
                                ? "cursor-grab"
                                : ""
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          {editable && (
                            <span
                              className="flex h-6 w-6 shrink-0 select-none items-center justify-center text-base leading-none text-muted-foreground/35"
                              title="拖拽排序"
                            >
                              ⠿
                            </span>
                          )}
                          <div className="relative flex shrink-0 flex-col items-center self-stretch">
                            {index > 0 && (
                              <span className="w-px flex-1 bg-border/70" />
                            )}
                            <span
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                                node.sortOrder === index
                                  ? "border border-primary/30 bg-primary text-primary-foreground"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {index + 1}
                            </span>
                            {index < detail.nodes.length - 1 && (
                              <span className="w-px flex-1 bg-border/70" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {node.name}{" "}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <span className="rounded-sm border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
                                {ASSIGNEE_LABEL[node.assigneeType] ?? node.assigneeType}
                                {node.assigneeType === "ROLE" && node.assigneeRole
                                  ? `（${ROLE_LABEL[node.assigneeRole] ?? node.assigneeRole}）`
                                  : ""}
                              </span>
                              <span className="rounded-sm border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
                                {node.ccRules ? (
                                  `抄送规则（${(node.ccRules as CcRule[]).length}）`
                                ) : (
                                  CC_LABEL[node.ccType] ?? node.ccType
                                )}
                              </span>
                              <span className="rounded-sm border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
                                {MULTI_LABEL[node.multiMode] ?? node.multiMode}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {editable && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="上移"
                                disabled={index === 0}
                                onClick={() => handleMoveNode(node, -1)}
                              >
                                上移
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="下移"
                                disabled={index === detail.nodes.length - 1}
                                onClick={() => handleMoveNode(node, 1)}
                              >
                                下移
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                title="复制节点"
                                onClick={() => handleDuplicateNode(node.id)}
                              >
                                复制
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="编辑节点"
                            disabled={!editable}
                            onClick={() => editable && openEditNode(node)}
                          >
                            编辑
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="删除节点"
                            disabled={!editable || detail.nodes.length <= 1}
                            onClick={() =>
                              editable &&
                              setConfirmDel({ kind: "node", id: node.id, label: node.name })
                            }
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                      {editable && index < detail.nodes.length - 1 && (
                        <div className="flex justify-center py-0.5 text-muted-foreground/30">
                          <svg
                            width="16"
                            height="12"
                            viewBox="0 0 16 12"
                            className="fill-none stroke-current"
                            aria-hidden="true"
                          >
                            <path
                              d="M8 0v8M4 4l4 4 4-4"
                              strokeWidth="1.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={openAddNode}>
                    添加节点
                  </Button>
                </div>
              </>
            )}
          </div>

          <DialogFooter className="mt-4">
            <div className="flex w-full items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="复制当前版本为新的草稿版本"
                onClick={() => detail && handleDuplicate(detail.id)}
                disabled={saving}
              >
                复制为新版本
              </Button>
              <Button type="button" variant="outline" onClick={closeDetail} disabled={saving}>
                关闭
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={confirmDel !== null} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            确定要删除{confirmDel?.kind === "draft" ? "流程版本" : "节点"}
            「{confirmDel?.label}」吗？此操作不可撤销。
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDel(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={saving}>
              {saving ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建版本 */}
      <Dialog open={showCreate} onOpenChange={(v) => !v && !saving && setShowCreate(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>新建流程版本</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor="wf-type">流程类型</Label>
              <SearchableSelect
                options={BIZ_TABS.map((t) => ({ value: t.key, label: t.label }))}
                value={createType}
                onValueChange={(v) => v && setCreateType(v as WorkflowBusinessType)}
                placeholder="请选择流程类型"
                triggerClassName="w-full"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wf-name">流程名称</Label>
              <Input
                id="wf-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="如：申请升级配件流程"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              创建后自动带一个「部门主管审批」节点，可在节点配置中增删改。
            </p>
            {configSummary && configSummary[createType]?.total > 0 && (
              <div className="rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                提示：该流程类型已有 {configSummary[createType].total} 个版本（其中{" "}
                {configSummary[createType].published} 个生效）。新建后将以新版本并存，切换生效需发布。
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowCreate(false)}
              disabled={saving}
            >
              取消
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 节点表单（添加 / 编辑）：审批人 / 抄送 分组 */}
      <Dialog
        open={nodeForm !== null}
        onOpenChange={(v) => {
          if (!v && !saving) setNodeForm(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{nodeForm?.mode === "edit" ? "编辑节点" : "添加节点"}</DialogTitle>
          </DialogHeader>
          {nodeForm && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="node-name">节点名称</Label>
                <Input
                  id="node-name"
                  value={nodeForm.name}
                  onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })}
                  placeholder="如：部门主管审批"
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  审批人
                </p>
                <div className="space-y-1">
                  <Label>审批人类型</Label>
                  <SearchableSelect
                    options={[
                      { value: "DEPT_MANAGER", label: "部门主管" },
                      { value: "EMP_MANAGER", label: "直属主管" },
                      { value: "ROLE", label: "按角色" },
                      { value: "INITIATOR", label: "发起人" },
                    ]}
                    value={nodeForm.assigneeType}
                    onValueChange={(v) => v && setNodeForm({ ...nodeForm, assigneeType: v })}
                    placeholder="请选择审批人类型"
                    triggerClassName="w-full"
                  />
                </div>
                {nodeForm.assigneeType === "ROLE" && (
                  <div className="space-y-1">
                    <Label>角色</Label>
                    <SearchableSelect
                      options={ROLE_OPTIONS}
                      value={nodeForm.assigneeRole}
                      onValueChange={(v) => v && setNodeForm({ ...nodeForm, assigneeRole: v })}
                      placeholder="请选择角色"
                      triggerClassName="w-full"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label>多人模式</Label>
                  <SearchableSelect
                    options={[
                      { value: "ANY", label: "或签（任一通过）" },
                      { value: "ALL", label: "会签（全部通过）" },
                    ]}
                    value={nodeForm.multiMode}
                    onValueChange={(v) => v && setNodeForm({ ...nodeForm, multiMode: v })}
                    placeholder="请选择多人模式"
                    triggerClassName="w-full"
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>抄送规则（可选）</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addRule}
                    disabled={saving}
                  >
                    添加规则
                  </Button>
                </div>
                {nodeForm.ccRules.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    未配置规则时不抄送；历史单值抄送已自动迁移为规则。
                  </p>
                )}
                {nodeForm.ccRules.map((rule, ruleIndex) => (
                  <div key={ruleIndex} className="space-y-1 rounded-md border p-2">
                    <div className="flex items-center gap-1">
                      <SearchableSelect
                        options={CC_RULE_TYPES.map((t) => ({
                          value: t,
                          label: CC_RULE_LABEL[t],
                        }))}
                        value={rule.type}
                        onValueChange={(v) =>
                          v &&
                          updateRule(ruleIndex, {
                            type: v,
                            roleKey: undefined,
                            userIds: undefined,
                          })
                        }
                        placeholder="请选择抄送规则类型"
                        triggerClassName="w-full"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="删除规则"
                        onClick={() => removeRule(ruleIndex)}
                        disabled={saving}
                      >
                        删除
                      </Button>
                    </div>
                    {rule.type === "ROLE" && (
                      <SearchableSelect
                        options={ROLE_OPTIONS}
                        value={rule.roleKey ?? ""}
                        onValueChange={(v) => updateRule(ruleIndex, { roleKey: v })}
                        placeholder="选择角色"
                        triggerClassName="w-full"
                      />
                    )}
                    {rule.type === "USER" && (
                      <Input
                        value={rule.userIds?.join(",") ?? ""}
                        placeholder="账号ID，逗号分隔"
                        aria-label={`抄送账号${ruleIndex + 1}`}
                        onChange={(e) =>
                          updateRule(ruleIndex, {
                            userIds: e.target.value
                              .split(",")
                              .map((s) => Number(s.trim()))
                              .filter((n) => Number.isInteger(n) && n > 0),
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setNodeForm(null)}
              disabled={saving}
            >
              取消
            </Button>
            <Button onClick={handleSaveNode} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}