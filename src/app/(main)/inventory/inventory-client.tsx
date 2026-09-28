"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { PagePagination } from "@/components/ui/page-pagination";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getStatusLabel } from "@/lib/status-labels";
import { formatTime } from "@/lib/utils";
import { Clock, Scale, ListOrdered, X } from "lucide-react";

// ---------- 类型（服务端 action 返回值） ----------

interface AgeRow {
  id: number;
  assetNo: string;
  name: string;
  status: string;
  ageDays: number;
  idleDays: number | null;
  isStagnant: boolean;
  categoryName: string;
}
interface AgeData {
  thresholdDays: number;
  total: number;
  stagnantCount: number;
  rows: AgeRow[];
}

interface ReconRow {
  modelId: number;
  modelName: string;
  brand: string;
  categoryName: string;
  stockQuantity: number;
  loggedBalance: number;
  difference: number;
  isBalanced: boolean;
}
interface ReconData {
  matchedCount: number;
  discrepantCount: number;
  rows: ReconRow[];
}

interface AllocRow {
  id: number;
  assetNo: string;
  name: string;
  status: string;
  createdAt: string | Date;
  categoryName: string;
}
interface AllocData {
  total: number;
  rows: AllocRow[];
}

interface InventoryClientProps {
  age: AgeData | null;
  recon: ReconData | null;
  alloc: AllocData | null;
}

// ---------- 状态配色（与首页驾驶舱一致） ----------

const STATUS_DOT: Record<string, string> = {
  IDLE: "#64748b",
  IN_USE: "#2563eb",
  IN_MAINTENANCE: "#f59e0b",
  SCRAPPED: "#ef4444",
  RESERVED: "#8b5cf6",
};

/** 每页条数 */
const PAGE_SIZE = 10;

const AGE_STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "IDLE", label: "闲置" },
  { value: "IN_USE", label: "在用" },
  { value: "IN_MAINTENANCE", label: "维修中" },
  { value: "SCRAPPED", label: "报废" },
];

function MetricTile({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: number;
  accent: string;
  hint?: string;
}) {
  return (
    <div className="flex min-h-[76px] flex-col justify-between rounded-lg border border-border/70 bg-muted/30 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums leading-none" style={{ color: accent }}>
          {value}
        </span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

function StatusCell({ status }: { status: string }) {
  const color = STATUS_DOT[status] ?? "#2455D9";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      {getStatusLabel(status)}
    </span>
  );
}

/** 关键字输入：带清空按钮，与设备列表一致 */
function KeywordInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-8"
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          onClick={() => onChange("")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function uniqueCategories(names: string[]): string[] {
  return Array.from(new Set(names.filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh"));
}

function categoryOptions(names: string[]) {
  return [
    { value: "all", label: "全部分类" },
    ...uniqueCategories(names).map((n) => ({ value: n, label: n })),
  ];
}

export function InventoryClient({ age, recon, alloc }: InventoryClientProps) {
  // ---------- 筛选状态 ----------
  const [ageKeyword, setAgeKeyword] = useState("");
  const [ageStatus, setAgeStatus] = useState("all");
  const [ageCategory, setAgeCategory] = useState("all");
  const [idleMin, setIdleMin] = useState("");

  const [reconKeyword, setReconKeyword] = useState("");
  const [reconCategory, setReconCategory] = useState("all");
  const [onlyDiff, setOnlyDiff] = useState(false);

  const [allocKeyword, setAllocKeyword] = useState("");
  const [allocCategory, setAllocCategory] = useState("all");

  // ---------- 分页状态 ----------
  const [agePage, setAgePage] = useState(1);
  const [reconPage, setReconPage] = useState(1);
  const [allocPage, setAllocPage] = useState(1);

  // ---------- 呆滞判定阈值（天）：页面可编辑，改动即时重算呆滞 ----------
  const THRESHOLD_KEY = "zt_inventory_stagnant_threshold";
  const [thresholdInput, setThresholdInput] = useState(String(age?.thresholdDays ?? 90));
  const threshold = useMemo(() => {
    const n = Number(thresholdInput);
    return Number.isNaN(n) || n <= 0 ? 90 : n;
  }, [thresholdInput]);

  // 刷新后恢复上次保存的阈值（首帧先渲染默认值避免 SSR hydration 不一致）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(THRESHOLD_KEY);
    if (saved != null) setThresholdInput(saved);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(THRESHOLD_KEY, thresholdInput);
    } catch {
      // 隐私模式等写入失败时静默跳过
    }
  }, [thresholdInput]);

  const stagnantCount = useMemo(
    () =>
      age
        ? age.rows.filter(
            (r) => r.idleDays != null && r.idleDays >= threshold
          ).length
        : 0,
    [age, threshold]
  );

  // 筛选变化后回到第 1 页
  useEffect(() => {
    setAgePage(1);
  }, [ageKeyword, ageStatus, ageCategory, idleMin]);
  useEffect(() => {
    setReconPage(1);
  }, [reconKeyword, reconCategory, onlyDiff]);
  useEffect(() => {
    setAllocPage(1);
  }, [allocKeyword, allocCategory]);

  // ---------- 过滤 ----------
  const ageRows = useMemo(() => {
    if (!age) return [];
    const kw = ageKeyword.trim().toLowerCase();
    const min = idleMin.trim() === "" ? null : Number(idleMin);
    return age.rows
      .filter((r) => {
        if (kw && !r.assetNo.toLowerCase().includes(kw) && !r.name.toLowerCase().includes(kw)) return false;
        if (ageStatus !== "all" && r.status !== ageStatus) return false;
        if (ageCategory !== "all" && r.categoryName !== ageCategory) return false;
        // 「闲置 ≥ 天数」筛选：仅保留闲置天数达标的设备
        if (min != null && !Number.isNaN(min)) {
          if (r.idleDays == null || r.idleDays < min) return false;
        }
        return true;
      })
      // 呆滞判定按当前可编辑阈值重算，而非服务端固定 90 天
      .map((r) => ({
        ...r,
        isStagnant: r.idleDays != null && r.idleDays >= threshold,
      }))
      .sort((a, b) => b.ageDays - a.ageDays);
  }, [age, ageKeyword, ageStatus, ageCategory, idleMin, threshold]);

  const ageTotalPages = Math.max(1, Math.ceil(ageRows.length / PAGE_SIZE));
  const ageSafePage = Math.min(agePage, ageTotalPages);
  const agePageItems = ageRows.slice((ageSafePage - 1) * PAGE_SIZE, ageSafePage * PAGE_SIZE);

  const reconRows = useMemo(() => {
    if (!recon) return [];
    const kw = reconKeyword.trim().toLowerCase();
    return recon.rows.filter((r) => {
      if (kw && !r.modelName.toLowerCase().includes(kw) && !r.brand.toLowerCase().includes(kw)) return false;
      if (reconCategory !== "all" && r.categoryName !== reconCategory) return false;
      if (onlyDiff && r.isBalanced) return false;
      return true;
    });
  }, [recon, reconKeyword, reconCategory, onlyDiff]);

  const reconTotalPages = Math.max(1, Math.ceil(reconRows.length / PAGE_SIZE));
  const reconSafePage = Math.min(reconPage, reconTotalPages);
  const reconPageItems = reconRows.slice((reconSafePage - 1) * PAGE_SIZE, reconSafePage * PAGE_SIZE);

  const allocRows = useMemo(() => {
    if (!alloc) return [];
    const kw = allocKeyword.trim().toLowerCase();
    return alloc.rows.filter((r) => {
      if (kw && !r.assetNo.toLowerCase().includes(kw) && !r.name.toLowerCase().includes(kw)) return false;
      if (allocCategory !== "all" && r.categoryName !== allocCategory) return false;
      return true;
    });
  }, [alloc, allocKeyword, allocCategory]);

  const allocTotalPages = Math.max(1, Math.ceil(allocRows.length / PAGE_SIZE));
  const allocSafePage = Math.min(allocPage, allocTotalPages);
  const allocPageItems = allocRows.slice((allocSafePage - 1) * PAGE_SIZE, allocSafePage * PAGE_SIZE);

  const ageCats = age ? age.rows.map((r) => r.categoryName) : [];
  const reconCats = recon ? recon.rows.map((r) => r.categoryName) : [];
  const allocCats = alloc ? alloc.rows.map((r) => r.categoryName) : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="库存分析"
        description="库龄呆滞、出入库对账与 先进先出分配建议，可搜索筛选定位目标。"
      />

      {/* 摘要指标条 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricTile label="设备总数" value={age?.total ?? 0} accent="#2455D9" hint="台" />
        <MetricTile
          label="呆滞资产"
          value={stagnantCount}
          accent={stagnantCount > 0 ? "#dc2626" : "#16a34a"}
          hint={`阈值 ${threshold} 天`}
        />
        <MetricTile label="账实平账" value={recon?.matchedCount ?? 0} accent="#16a34a" hint="个型号" />
        <MetricTile
          label="账实差异"
          value={recon?.discrepantCount ?? 0}
          accent={recon && recon.discrepantCount > 0 ? "#dc2626" : "#64748b"}
          hint="个型号"
        />
        <MetricTile label="可分配设备" value={alloc?.total ?? 0} accent="#2455D9" hint="台" />
      </div>

      <Tabs defaultValue="age">
        <TabsList>
          <TabsTrigger value="age" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
            库龄呆滞
          </TabsTrigger>
          <TabsTrigger value="recon" className="gap-1.5">
            <Scale className="h-3.5 w-3.5" strokeWidth={1.75} />
            出入库对账
          </TabsTrigger>
          <TabsTrigger value="alloc" className="gap-1.5">
            <ListOrdered className="h-3.5 w-3.5" strokeWidth={1.75} />
            先进先出分配建议
          </TabsTrigger>
        </TabsList>

        {/* ===== Tab 1：库龄呆滞 ===== */}
        <TabsContent value="age">
          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/50 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-primary" strokeWidth={1.75} />
                库龄 / 呆滞统计
              </CardTitle>
              <span className="text-xs tabular-nums text-muted-foreground">共 {ageRows.length} 台</span>
            </CardHeader>
            <div className="flex flex-wrap items-center gap-3 border-b border-border/50 p-4">
              <KeywordInput
                value={ageKeyword}
                onChange={setAgeKeyword}
                placeholder="搜索编号 / 名称"
                className="w-64"
              />
              <SearchableSelect
                value={ageStatus}
                onValueChange={setAgeStatus}
                options={AGE_STATUS_OPTIONS}
                placeholder="全部状态"
                triggerClassName="w-40"
              />
              <SearchableSelect
                value={ageCategory}
                onValueChange={setAgeCategory}
                options={categoryOptions(ageCats)}
                placeholder="全部分类"
                triggerClassName="w-40"
              />
              <Input
                value={idleMin}
                onChange={(e) => setIdleMin(e.target.value)}
                placeholder="闲置 ≥ 天数"
                inputMode="numeric"
                className="w-28"
              />
              <Input
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                placeholder="呆滞阈值（天）"
                inputMode="numeric"
                className="w-32"
              />
            </div>
            <CardContent className="p-0">
              {ageRows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">资产编号</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>分类</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">库龄（天）</TableHead>
                      <TableHead className="text-right">闲置（天）</TableHead>
                      <TableHead className="pr-5">判定</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agePageItems.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="pl-5 font-mono text-xs text-muted-foreground">
                          {a.assetNo}
                        </TableCell>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-muted-foreground">{a.categoryName || "—"}</TableCell>
                        <TableCell>
                          <StatusCell status={a.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{a.ageDays}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.idleDays != null ? a.idleDays : "—"}
                        </TableCell>
                        <TableCell className="pr-5">
                          {a.isStagnant ? (
                            <Badge variant="destructive">呆滞</Badge>
                          ) : a.idleDays != null ? (
                            <Badge variant="outline" className="text-muted-foreground">
                              正常
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                  没有符合筛选条件的资产
                </div>
              )}
              {ageRows.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-3">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    共 {ageRows.length} 条，第 {ageSafePage}/{ageTotalPages} 页
                  </span>
                  <PagePagination
                    current={ageSafePage}
                    total={ageTotalPages}
                    onPageChange={setAgePage}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Tab 2：出入库对账 ===== */}
        <TabsContent value="recon">
          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/50 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="h-4 w-4 text-primary" strokeWidth={1.75} />
                出入库流水对账
              </CardTitle>
              <span className="text-xs tabular-nums text-muted-foreground">共 {reconRows.length} 个型号</span>
            </CardHeader>
            <div className="flex flex-wrap items-center gap-3 border-b border-border/50 p-4">
              <KeywordInput
                value={reconKeyword}
                onChange={setReconKeyword}
                placeholder="搜索型号 / 品牌"
                className="w-64"
              />
              <SearchableSelect
                value={reconCategory}
                onValueChange={setReconCategory}
                options={categoryOptions(reconCats)}
                placeholder="全部分类"
                triggerClassName="w-40"
              />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={onlyDiff} onCheckedChange={(v) => setOnlyDiff(v === true)} />
                仅看差异
              </label>
            </div>
            <CardContent className="p-0">
              {reconRows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">配件型号</TableHead>
                      <TableHead>品牌</TableHead>
                      <TableHead>分类</TableHead>
                      <TableHead className="text-right">实存</TableHead>
                      <TableHead className="text-right">流水结存</TableHead>
                      <TableHead className="text-right">差异</TableHead>
                      <TableHead className="pr-5">状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconPageItems.map((r) => (
                      <TableRow key={r.modelId}>
                        <TableCell className="pl-5 font-medium">{r.modelName}</TableCell>
                        <TableCell className="text-muted-foreground">{r.brand || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{r.categoryName}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.stockQuantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.loggedBalance}</TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${r.isBalanced ? "text-muted-foreground" : "text-red-600"}`}
                        >
                          {r.difference > 0 ? `+${r.difference}` : r.difference}
                        </TableCell>
                        <TableCell className="pr-5">
                          {r.isBalanced ? (
                            <Badge variant="outline" className="text-emerald-600">
                              平账
                            </Badge>
                          ) : (
                            <Badge variant="destructive">差异</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                  没有符合筛选条件的配件型号
                </div>
              )}
              {reconRows.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-3">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    共 {reconRows.length} 条，第 {reconSafePage}/{reconTotalPages} 页
                  </span>
                  <PagePagination
                    current={reconSafePage}
                    total={reconTotalPages}
                    onPageChange={setReconPage}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== Tab 3：先进先出分配建议 ===== */}
        <TabsContent value="alloc">
          <Card className="border-border/70">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/50 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ListOrdered className="h-4 w-4 text-primary" strokeWidth={1.75} />
                先进先出分配建议
              </CardTitle>
              <span className="text-xs tabular-nums text-muted-foreground">共 {allocRows.length} 台</span>
            </CardHeader>
            <div className="flex flex-wrap items-center gap-3 border-b border-border/50 p-4">
              <KeywordInput
                value={allocKeyword}
                onChange={setAllocKeyword}
                placeholder="搜索编号 / 名称"
                className="w-64"
              />
              <SearchableSelect
                value={allocCategory}
                onValueChange={setAllocCategory}
                options={categoryOptions(allocCats)}
                placeholder="全部分类"
                triggerClassName="w-40"
              />
            </div>
            <CardContent className="p-0">
              {allocRows.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">序号</TableHead>
                      <TableHead>资产编号</TableHead>
                      <TableHead>名称</TableHead>
                      <TableHead>分类</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="pr-5">入库时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocPageItems.map((a, idx) => (
                      <TableRow key={a.id}>
                        <TableCell className="pl-5 tabular-nums text-muted-foreground">
                          {idx + 1}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {a.assetNo}
                        </TableCell>
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-muted-foreground">{a.categoryName || "—"}</TableCell>
                        <TableCell>
                          <StatusCell status={a.status} />
                        </TableCell>
                        <TableCell className="pr-5 tabular-nums text-muted-foreground">
                          {formatTime(a.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                  没有符合筛选条件的可分配设备
                </div>
              )}
              {allocRows.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-4 py-3">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    共 {allocRows.length} 条，第 {allocSafePage}/{allocTotalPages} 页
                  </span>
                  <PagePagination
                    current={allocSafePage}
                    total={allocTotalPages}
                    onPageChange={setAllocPage}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
