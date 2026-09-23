"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { type LucideIcon, TrendingUp, Trash2, Undo2, RefreshCw, Wrench, LogOut } from "lucide-react";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { submitApprovalRequest } from "@/actions/approval.actions";

/** 每类业务类型的语义图标（用于流程说明条，强化视觉引导） */
const BIZ_ICON: Record<BizType, LucideIcon> = {
  ASSET_UPGRADE: TrendingUp,
  ASSET_SCRAP: Trash2,
  ASSET_RETURN: Undo2,
  ASSET_REPLACE: RefreshCw,
  ASSET_REPAIR: Wrench,
  ASSET_DEPART: LogOut,
};

type BizType =
  | "ASSET_UPGRADE"
  | "ASSET_SCRAP"
  | "ASSET_RETURN"
  | "ASSET_REPLACE"
  | "ASSET_REPAIR"
  | "ASSET_DEPART";
type ActionType = "UPGRADE" | "DOWNGRADE";

interface BizTab {
  value: BizType;
  label: string;
  /** 是否需要选择设备 */
  needsAsset: boolean;
  /** 需要选择离职员工（DEPART 专用，不选设备） */
  needsEmployee: boolean;
  /** 只有升级/降级需要配件类别+动作 */
  needsComponent: boolean;
  titlePlaceholder: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  /** 流程说明条文案（随业务类型切换） */
  blurb: string;
}

const BIZ_TABS: BizTab[] = [
  {
    value: "ASSET_UPGRADE",
    label: "升级配件",
    needsAsset: true,
    needsEmployee: false,
    needsComponent: true,
    titlePlaceholder: "如：申请升级内存",
    reasonLabel: "申请原因",
    reasonPlaceholder: "说明升级/降级原因，便于审批人了解情况",
    blurb: "为设备申报配件升级或降级，审批通过后由资产管理员执行变更。",
  },
  {
    value: "ASSET_SCRAP",
    label: "资产报废",
    needsAsset: true,
    needsEmployee: false,
    needsComponent: false,
    titlePlaceholder: "如：申请报废损坏的电脑主机",
    reasonLabel: "报废原因",
    reasonPlaceholder: "说明报废原因，便于审批人核验",
    blurb: "为不再使用的设备发起报废申请，审批通过后自动执行报废。",
  },
  {
    value: "ASSET_RETURN",
    label: "设备退回",
    needsAsset: true,
    needsEmployee: false,
    needsComponent: false,
    titlePlaceholder: "如：申请退回不再使用的显示器",
    reasonLabel: "退回原因",
    reasonPlaceholder: "说明退回原因，便于审批人核验",
    blurb: "为公司设备发起退回申请，审批通过后自动执行退回。",
  },
  {
    value: "ASSET_REPLACE",
    label: "更换设备",
    needsAsset: true,
    needsEmployee: false,
    needsComponent: false,
    titlePlaceholder: "如：申请更换故障笔记本",
    reasonLabel: "更换原因",
    reasonPlaceholder: "说明更换原因，新设备由资产管理员执行时分配",
    blurb: "为故障设备申请更换，审批通过后由资产管理员分配新机。",
  },
  {
    value: "ASSET_REPAIR",
    label: "设备维修",
    needsAsset: true,
    needsEmployee: false,
    needsComponent: false,
    titlePlaceholder: "如：申请送修无法开机的电脑",
    reasonLabel: "维修原因",
    reasonPlaceholder: "说明维修原因，备用机由资产管理员执行时分配",
    blurb: "为故障设备申请维修，审批通过后由资产管理员分配备用机。",
  },
  {
    value: "ASSET_DEPART",
    label: "员工离职",
    needsAsset: false,
    needsEmployee: true,
    needsComponent: false,
    titlePlaceholder: "如：申请办理员工离职交接",
    reasonLabel: "离职原因",
    reasonPlaceholder: "说明离职原因，审批通过后生成交接单回收名下设备",
    blurb: "为离职员工办理交接，审批通过后生成交接单并回收名下设备。",
  },
];

const ACTION_OPTIONS: { value: ActionType; label: string }[] = [
  { value: "UPGRADE", label: "升级" },
  { value: "DOWNGRADE", label: "降级" },
];

type AssetCat = { assetId: number; categoryId: number; categoryName: string };
type EmployeeOpt = { id: number; employeeNo: string; name: string };
type DelegationTarget = {
  id: number;
  employeeNo: string;
  name: string;
  assets: { id: number; assetNo: string; name: string }[];
  assetCats: AssetCat[];
};

export function NewRequestClient({
  assets,
  assetCats,
  employees,
  delegation = [],
}: {
  assets: { id: number; assetNo: string; name: string }[];
  assetCats: AssetCat[];
  employees: EmployeeOpt[];
  delegation?: DelegationTarget[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [bizType, setBizType] = useState<BizType>("ASSET_UPGRADE");
  const [title, setTitle] = useState("");
  const [assetId, setAssetId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [action, setAction] = useState<ActionType>("UPGRADE");
  const [employeeId, setEmployeeId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [forWhom, setForWhom] = useState<string>(""); // "" = 本人，否则为被代申员工 id
  const [submitting, setSubmitting] = useState(false);

  const tab = BIZ_TABS.find((t) => t.value === bizType)!;
  const ActiveIcon = BIZ_ICON[bizType];

  // 是否显示「为谁申请」：有可代申的下属且当前业务类型需选设备（离职单不适用）
  const showDelegation = delegation.length > 0 && !tab.needsEmployee;
  const delegateTarget = delegation.find((d) => d.id === Number(forWhom));

  // 代申模式下切换到下属的设备/配件范围
  const effectiveAssets = forWhom ? (delegateTarget?.assets ?? []) : assets;
  const effectiveAssetCats = forWhom ? (delegateTarget?.assetCats ?? []) : assetCats;

  const selectedAsset = effectiveAssets.find((a) => a.id === Number(assetId));

  // 所选设备已有的配件类别（去重）
  const currentCats = Array.from(
    new Map(
      effectiveAssetCats
        .filter((c) => c.assetId === Number(assetId))
        .map((c) => [c.categoryId, { categoryId: c.categoryId, categoryName: c.categoryName }])
    ).values()
  );

  // 升级时单台在用设备自动带出，无需手动选择
  useEffect(() => {
    if (bizType === "ASSET_UPGRADE" && effectiveAssets.length === 1 && !assetId) {
      setAssetId(String(effectiveAssets[0].id));
    }
  }, [bizType, effectiveAssets, assetId]);

  const resetUpgradeFields = () => {
    setCategoryId("");
    setAction("UPGRADE");
  };

  const switchTab = (t: BizTab) => {
    setBizType(t.value);
    setAssetId("");
    setEmployeeId("");
    resetUpgradeFields();
    setReason("");
  };

  const handleWhoChange = (value: string) => {
    setForWhom(value);
    setAssetId("");
    resetUpgradeFields();
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast({ title: "请输入申请标题", variant: "destructive" });
      return;
    }
    if (tab.needsEmployee && !employeeId) {
      toast({ title: "请选择离职员工", variant: "destructive" });
      return;
    }
    if (tab.needsAsset && !assetId) {
      toast({ title: "请选择设备", variant: "destructive" });
      return;
    }
    if (bizType === "ASSET_UPGRADE" && !categoryId) {
      toast({ title: "请选择配件类别", variant: "destructive" });
      return;
    }
    setSubmitting(true);

    const payload =
      bizType === "ASSET_DEPART"
        ? { targetEmployeeId: Number(employeeId), reason: reason.trim() }
        : bizType === "ASSET_UPGRADE"
          ? {
              assetId: Number(assetId),
              componentCategoryId: Number(categoryId),
              action,
              reason: reason.trim(),
              // 可读名快照（详情页免二次查询）
              assetNo: selectedAsset?.assetNo,
              assetName: selectedAsset?.name,
              categoryName: currentCats.find(
                (c) => c.categoryId === Number(categoryId)
              )?.categoryName,
            }
          : { assetId: Number(assetId), reason: reason.trim() };

    const result = await submitApprovalRequest({
      title: title.trim(),
      businessType: bizType,
      payload,
      // 主管代申：代申时不传则默认本人
      ...(forWhom ? { forEmployeeId: Number(forWhom) } : {}),
    });
    setSubmitting(false);
    if (result.success) {
      toast({ title: "提交成功", description: result.data.requestNo });
      router.push(`/approvals/${result.data.id}`);
    } else {
      toast({ title: "提交失败", description: result.error, variant: "destructive" });
    }
  };

  const displayAsset = (o: { id: number; assetNo: string; name: string }) =>
    o.assetNo ? `${o.assetNo} · ${o.name}` : o.name;
  const displayEmployee = (o: EmployeeOpt) => `${o.employeeNo} · ${o.name}`;

  const bizOptions = BIZ_TABS.map((t) => ({ value: t.value, label: t.label }));
  const whoOptions = [{ value: "", label: "本人" }, ...delegation.map((d) => ({ value: String(d.id), label: displayEmployee(d) }))];
  const assetOptions = effectiveAssets.map((a) => ({ value: String(a.id), label: displayAsset(a) }));
  const catOptions = currentCats.map((c) => ({ value: String(c.categoryId), label: c.categoryName }));
  const actionOptions = ACTION_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
  const employeeOptions = employees.map((e) => ({ value: String(e.id), label: displayEmployee(e) }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="发起申请"
        description="选择业务类型发起申请，提交后按对应审批流程逐级审批"
      />

      <div className="mx-auto w-full max-w-4xl">
        <Card className="overflow-hidden border-border shadow-none">
          {/* 顶部细色带：以强调色区分层级，摒弃大阴影 */}
          <div className="h-1 bg-primary/80" />

          <CardContent className="p-0">
            {/* 卡片头部：标题 + 步骤提示 */}
            <div className="border-b px-6 pt-5 pb-4 sm:px-8">
              <CardTitle className="font-display text-lg">{`申请${tab.label}`}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                选择业务类型 → 填写申请信息 → 提交审批
              </p>
            </div>

            <div className="px-6 py-6 sm:px-8">
              <div className="space-y-6">
                {/* 业务类型 + 流程说明条（随类型联动） */}
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="req text-sm font-medium text-foreground">
                      业务类型
                    </Label>
                    <SearchableSelect
                      options={bizOptions}
                      value={bizType}
                      onValueChange={(v) => {
                        const t = BIZ_TABS.find((x) => x.value === v);
                        if (t) switchTab(t);
                      }}
                      placeholder="选择业务类型"
                      ariaLabel="选择业务类型"
                    />
                  </div>

                  <div className="flex items-start gap-3 rounded-lg border bg-muted/60 px-4 py-3">
                    <ActiveIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <p className="text-sm leading-relaxed text-foreground/85">
                      {tab.blurb}
                    </p>
                  </div>
                </div>

                {showDelegation && (
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium text-foreground">
                      为谁申请
                    </Label>
                    <SearchableSelect
                      options={whoOptions}
                      value={forWhom}
                      onValueChange={handleWhoChange}
                      placeholder="本人"
                      ariaLabel="为谁申请"
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="req-title" className="req text-sm font-medium text-foreground">
                    申请标题
                  </Label>
                  <Input
                    id="req-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={tab.titlePlaceholder}
                  />
                </div>

                {tab.needsEmployee && (
                  <div className="space-y-1.5">
                    <Label className="req text-sm font-medium text-foreground">
                      离职员工
                    </Label>
                    <SearchableSelect
                      options={employeeOptions}
                      value={employeeId}
                      onValueChange={setEmployeeId}
                      placeholder="请选择离职员工"
                      emptyText="暂无员工"
                      ariaLabel="选择离职员工"
                    />
                  </div>
                )}

                {tab.needsAsset && (
                  <div className="space-y-1.5">
                    <Label className="req text-sm font-medium text-foreground">
                      设备
                    </Label>
                    <SearchableSelect
                      options={assetOptions}
                      value={assetId}
                      onValueChange={(v) => {
                        setAssetId(v);
                        resetUpgradeFields();
                      }}
                      placeholder="请选择设备"
                      emptyText="暂无可用设备"
                      ariaLabel="选择设备"
                    />
                  </div>
                )}

                {tab.needsComponent && (
                  <div className="grid grid-cols-1 gap-x-6 gap-y-6 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="req text-sm font-medium text-foreground">
                        配件类别
                      </Label>
                      <SearchableSelect
                        options={catOptions}
                        value={categoryId}
                        onValueChange={setCategoryId}
                        placeholder={assetId ? "请选择配件类别" : "请先选择设备"}
                        emptyText="该设备暂无配件"
                        ariaLabel="选择配件类别"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="req text-sm font-medium text-foreground">
                        动作
                      </Label>
                      <SearchableSelect
                        options={actionOptions}
                        value={action}
                        onValueChange={(v) => {
                          // 动作无“空”概念：仅接受有效值（升级/降级），避免重选当前项被清空
                          if (v) setAction(v as ActionType);
                        }}
                        placeholder="请选择动作"
                        ariaLabel="选择动作"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="req-reason" className="req text-sm font-medium text-foreground">
                    {tab.reasonLabel}
                  </Label>
                  <Textarea
                    id="req-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={tab.reasonPlaceholder}
                    rows={3}
                  />
                </div>
              </div>

              {/* 提交栏 */}
              <div className="mt-7 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  {submitting ? "正在提交，请稍候…" : "提交后将进入对应审批流程"}
                </p>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="min-w-[7rem]"
                >
                  {submitting ? "提交中..." : "提交申请"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}