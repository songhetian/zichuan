"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { formatTime } from "@/lib/utils";
import { getMyTodoTasks } from "@/actions/approval.actions";

type TodoItem = {
  id: number;
  requestId: number;
  requestNo: string;
  title: string;
  nodeName: string;
  status: string;
  createdAt: string;
};

export function TodoClient() {
  const { toast } = useToast();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await getMyTodoTasks();
    setLoading(false);
    if (result.success) {
      setItems(
        result.data.map((t) => ({
          ...t,
          createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
        }))
      );
    } else {
      toast({ title: "加载失败", description: result.error, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <PageHeader title="我的待办" description="需要我审批的申请单" />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>待审批列表</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={load}>
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">单号</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className="w-[140px]">当前节点</TableHead>
                <TableHead className="w-[140px]">提交时间</TableHead>
                <TableHead className="w-[90px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.requestNo}</TableCell>
                  <TableCell>{t.title}</TableCell>
                  <TableCell>{t.nodeName}</TableCell>
                  <TableCell>{formatTime(t.createdAt)}</TableCell>
                  <TableCell>
                    <Link href={`/approvals/${t.requestId}`}>
                      <Button type="button" variant="outline" size="sm">
                        去处理
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {loading ? "加载中..." : "暂无待办"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
