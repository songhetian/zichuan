"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/features/data-table";
import { PageHeader } from "@/components/features/page-header";
import { ConfirmDialog } from "@/components/features/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createStocktakeSession,
  completeStocktakeSession,
  getStocktakeSessionById,
} from "@/actions/stocktake.actions";

interface StocktakeSession {
  id: number;
  name: string;
  description: string | null;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
}

interface StocktakeListClientProps {
  sessions: StocktakeSession[];
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING: { label: "进行中", variant: "secondary" },
  COMPLETED: { label: "已完成", variant: "default" },
};

const columns: ColumnDef<StocktakeSession>[] = [
  { accessorKey: "name", header: "名称" },
  {
    accessorKey: "status",
    header: "状态",
    cell: ({ row }) => {
      const status = row.original.status;
      const config = statusConfig[status] ?? { label: status, variant: "outline" as const };
      return <Badge variant={config.variant}>{config.label}</Badge>;
    },
  },
  {
    accessorKey: "startedAt",
    header: "创建时间",
    cell: ({ row }) => new Date(row.original.startedAt).toLocaleString("zh-CN"),
  },
  {
    id: "actions",
    header: "操作",
    cell: ({ row }) => {
      const session = row.original;
      return (
        <div className="flex items-center gap-1 justify-center">
          <StocktakeActionButtons session={session} />
        </div>
      );
    },
  },
];

function StocktakeActionButtons({ session }: { session: StocktakeSession }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleViewDetail = async () => {
    setLoading(true);
    const result = await getStocktakeSessionById(session.id);
    setLoading(false);
    if (result.success) {
      setRecords(result.data.records);
      setDetailOpen(true);
    } else {
      toast({ title: "获取详情失败", description: result.error, variant: "destructive" });
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
      toast({ title: "操作失败", description: result.error, variant: "destructive" });
    }
    setCompleteOpen(false);
  };

  const resultLabelMap: Record<string, string> = {
    NORMAL: "正常",
    MISSING: "盘亏",
    EXTRA: "盘盈",
  };

  return (
    <>
      <Button variant="ghost" size="icon" title="详情" onClick={handleViewDetail}>
        <Eye className="h-4 w-4" />
      </Button>
      {session.status === "PENDING" && (
        <Button variant="outline" size="sm" onClick={() => setCompleteOpen(true)}>
          完成
        </Button>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>盘点详情 - {session.name}</DialogTitle>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>设备编号</TableHead>
                <TableHead>预期状态</TableHead>
                <TableHead>实际结果</TableHead>
                <TableHead>备注</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.assetNo}</TableCell>
                  <TableCell>{r.expectedStatus}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{resultLabelMap[r.actualStatus] ?? r.actualStatus}</Badge>
                  </TableCell>
                  <TableCell>{r.remark ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="确认完成盘点"
        description={`确定要完成盘点任务「${session.name}」吗？完成后将无法修改。`}
        onConfirm={handleComplete}
      />
    </>
  );
}

export function StocktakeListClient({ sessions }: StocktakeListClientProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    const result = await createStocktakeSession({
      name: name.trim(),
      description: description.trim() || undefined,
      operator: "admin",
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "盘点任务创建成功" });
      setCreateOpen(false);
      setName("");
      setDescription("");
      setStatusFilter("");
      router.refresh();
    } else {
      toast({ title: "创建失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="库存盘点"
        description="创建和管理盘点任务"
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            新建盘点
          </Button>
        }
      />
      <DataTable columns={columns} data={sessions} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建盘点任务</DialogTitle>
            <DialogDescription>创建新的库存盘点任务</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>盘点名称</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="请输入盘点名称" />
            </div>
            <div className="space-y-2">
              <Label>备注说明</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="可选" rows={3} />
            </div>
            <div className="space-y-2">
              <Label>状态筛选（可选）</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="全部设备" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部设备</SelectItem>
                  <SelectItem value="IDLE">闲置</SelectItem>
                  <SelectItem value="IN_USE">在用</SelectItem>
                  <SelectItem value="IN_MAINTENANCE">维修中</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={loading || !name.trim()}>
              {loading ? "创建中..." : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
