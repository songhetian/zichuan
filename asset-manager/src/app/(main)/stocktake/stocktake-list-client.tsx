"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Plus, Eye } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  createStocktakeSession,
  completeStocktakeSession,
} from "@/actions/stocktake.actions";

const stocktakeSchema = z.object({
  name: z.string().min(1, "盘点名称不能为空"),
  description: z.string().optional(),
});

type StocktakeFormValues = z.infer<typeof stocktakeSchema>;

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
  const [completeOpen, setCompleteOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleViewDetail = () => {
    router.push(`/stocktake/${session.id}`);
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

  return (
    <>
      <Button variant="ghost" size="icon" title="详情" onClick={handleViewDetail}>
        <Eye className="h-4 w-4" />
      </Button>
      {session.status === "OPEN" && (
        <Button variant="outline" size="sm" onClick={() => setCompleteOpen(true)}>
          完成
        </Button>
      )}

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
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const createForm = useForm<StocktakeFormValues>({
    resolver: zodResolver(stocktakeSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const handleCreate = async (values: StocktakeFormValues) => {
    setLoading(true);
    const result = await createStocktakeSession({
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
      operator: "admin",
    });
    setLoading(false);
    if (result.success) {
      toast({ title: "盘点任务创建成功" });
      setCreateOpen(false);
      createForm.reset();
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

      <Dialog open={createOpen} onOpenChange={(open) => {
        if (!open) createForm.reset();
        setCreateOpen(open);
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建盘点任务</DialogTitle>
            <DialogDescription>创建新的库存盘点任务</DialogDescription>
          </DialogHeader>
          <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4">
            <div className="space-y-2">
              <Label>盘点名称</Label>
              <Input {...createForm.register("name")} placeholder="请输入盘点名称" />
              {createForm.formState.errors.name && (
                <p className="text-sm text-destructive">{createForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>备注说明</Label>
              <Textarea {...createForm.register("description")} placeholder="可选" rows={3} />
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "创建中..." : "确认"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
