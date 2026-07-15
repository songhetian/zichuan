"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/features/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, XCircle, AlertCircle, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  updateStocktakeRecord,
  completeStocktakeSession,
} from "@/actions/stocktake.actions";
import { ConfirmDialog } from "@/components/features/confirm-dialog";

interface StocktakeRecord {
  id: number;
  assetId: number;
  assetNo: string;
  expectedStatus: string;
  actualStatus: string;
  remark: string | null;
}

interface StocktakeDetailClientProps {
  session: {
    id: number;
    name: string;
    description: string | null;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
  };
  records: StocktakeRecord[];
}

const statusMap: Record<string, string> = {
  IDLE: "闲置",
  IN_USE: "在用",
  IN_MAINTENANCE: "维修中",
  SCRAPPED: "已报废",
};

const resultConfig: Record<
  string,
  { label: string; icon: any; color: string; bgColor: string }
> = {
  NORMAL: {
    label: "正常",
    icon: CheckCircle2,
    color: "text-green-600",
    bgColor: "bg-green-50 border-green-200 hover:bg-green-100",
  },
  MISSING: {
    label: "盘亏",
    icon: XCircle,
    color: "text-red-600",
    bgColor: "bg-red-50 border-red-200 hover:bg-red-100",
  },
  EXTRA: {
    label: "盘盈",
    icon: AlertCircle,
    color: "text-blue-600",
    bgColor: "bg-blue-50 border-blue-200 hover:bg-blue-100",
  },
};

export function StocktakeDetailClient({
  session,
  records: initialRecords,
}: StocktakeDetailClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [records, setRecords] = useState(initialRecords);
  const [selectedRecord, setSelectedRecord] = useState<StocktakeRecord | null>(
    null
  );
  const [editOpen, setEditOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedRecord || !editOpen) return;

      const key = e.key.toLowerCase();
      if (key === "n") {
        handleUpdateRecord("NORMAL");
      } else if (key === "m") {
        handleUpdateRecord("MISSING");
      } else if (key === "e") {
        handleUpdateRecord("EXTRA");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedRecord, editOpen]);

  const handleUpdateRecord = async (actualStatus: string) => {
    if (!selectedRecord) return;

    setLoading(true);
    const result = await updateStocktakeRecord(selectedRecord.id, {
      actualStatus: actualStatus as "NORMAL" | "MISSING" | "EXTRA",
      remark: selectedRecord.remark ?? undefined,
    });
    setLoading(false);

    if (result.success) {
      setRecords((prev) =>
        prev.map((r) =>
          r.id === selectedRecord.id ? { ...r, actualStatus } : r
        )
      );
      toast({ title: "更新成功" });
      setEditOpen(false);
      setSelectedRecord(null);
    } else {
      toast({
        title: "更新失败",
        description: result.error,
        variant: "destructive",
      });
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    const result = await completeStocktakeSession(session.id);
    setLoading(false);

    if (result.success) {
      toast({
        title: "盘点完成",
        description: `正常: ${result.data.normal}, 盘亏: ${result.data.missing}, 盘盈: ${result.data.extra}`,
      });
      router.refresh();
    } else {
      toast({
        title: "操作失败",
        description: result.error,
        variant: "destructive",
      });
    }
    setCompleteOpen(false);
  };

  const handleEditRecord = (record: StocktakeRecord) => {
    setSelectedRecord(record);
    setEditOpen(true);
  };

  // 计算统计数据
  const total = records.length;
  const normalCount = records.filter((r) => r.actualStatus === "NORMAL").length;
  const missingCount = records.filter((r) => r.actualStatus === "MISSING").length;
  const extraCount = records.filter((r) => r.actualStatus === "EXTRA").length;
  const progress = total > 0 ? ((normalCount + missingCount + extraCount) / total) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/stocktake")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span>{session.name}</span>
          </div>
        }
        description={session.description || "盘点任务详情"}
        action={
          session.status === "OPEN" ? (
            <Button onClick={() => setCompleteOpen(true)}>完成盘点</Button>
          ) : (
            <Badge variant="default">已完成</Badge>
          )
        }
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-lg border p-4">
          <div className="text-sm text-muted-foreground mb-1">总设备数</div>
          <div className="text-2xl font-bold">{total}</div>
        </div>
        <div className="bg-green-50 rounded-lg border border-green-200 p-4">
          <div className="text-sm text-green-700 mb-1">正常</div>
          <div className="text-2xl font-bold text-green-600">{normalCount}</div>
        </div>
        <div className="bg-red-50 rounded-lg border border-red-200 p-4">
          <div className="text-sm text-red-700 mb-1">盘亏</div>
          <div className="text-2xl font-bold text-red-600">{missingCount}</div>
        </div>
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
          <div className="text-sm text-blue-700 mb-1">盘盈</div>
          <div className="text-2xl font-bold text-blue-600">{extraCount}</div>
        </div>
      </div>

      {/* 进度条 */}
      <div className="bg-card rounded-lg border p-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">盘点进度</span>
          <span className="font-medium">{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* 设备卡片列表 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {records.map((record) => {
          const config = resultConfig[record.actualStatus];
          const Icon = config.icon;
          const expectedLabel = statusMap[record.expectedStatus] ?? record.expectedStatus;

          return (
            <div
              key={record.id}
              className={`bg-card rounded-lg border-2 p-4 cursor-pointer transition-all hover:shadow-md ${
                session.status === "OPEN" ? "hover:border-primary" : ""
              }`}
              onClick={() => session.status === "OPEN" && handleEditRecord(record)}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono text-sm text-muted-foreground">
                    {record.assetNo}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    预期状态: {expectedLabel}
                  </div>
                </div>
                <Icon className={`h-6 w-6 ${config.color}`} />
              </div>

              <div className="flex items-center justify-between">
                <Badge variant="outline" className={config.bgColor}>
                  {config.label}
                </Badge>
                {record.remark && (
                  <div className="text-xs text-muted-foreground truncate max-w-[120px]">
                    {record.remark}
                  </div>
                )}
              </div>

              {session.status === "OPEN" && (
                <div className="mt-3 pt-3 border-t text-xs text-center text-muted-foreground">
                  点击修改盘点结果
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 编辑对话框 */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>盘点设备</DialogTitle>
            <DialogDescription>
              设备编号: {selectedRecord?.assetNo}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              预期状态: {statusMap[selectedRecord?.expectedStatus ?? ""] ?? selectedRecord?.expectedStatus}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                className="h-20 flex-col gap-2 bg-green-50 border-green-200 hover:bg-green-100"
                onClick={() => handleUpdateRecord("NORMAL")}
                disabled={loading}
              >
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                <span className="text-sm">正常 (N)</span>
              </Button>
              <Button
                variant="outline"
                className="h-20 flex-col gap-2 bg-red-50 border-red-200 hover:bg-red-100"
                onClick={() => handleUpdateRecord("MISSING")}
                disabled={loading}
              >
                <XCircle className="h-6 w-6 text-red-600" />
                <span className="text-sm">盘亏 (M)</span>
              </Button>
              <Button
                variant="outline"
                className="h-20 flex-col gap-2 bg-blue-50 border-blue-200 hover:bg-blue-100"
                onClick={() => handleUpdateRecord("EXTRA")}
                disabled={loading}
              >
                <AlertCircle className="h-6 w-6 text-blue-600" />
                <span className="text-sm">盘盈 (E)</span>
              </Button>
            </div>

            <div className="space-y-2">
              <Label>备注（可选）</Label>
              <Textarea
                value={selectedRecord?.remark ?? ""}
                onChange={(e) => {
                  if (selectedRecord) {
                    setSelectedRecord({ ...selectedRecord, remark: e.target.value });
                  }
                }}
                placeholder="输入备注信息"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="确认完成盘点"
        description={`确定要完成盘点任务「${session.name}」吗？完成后将无法修改。`}
        onConfirm={handleComplete}
      />
    </div>
  );
}
