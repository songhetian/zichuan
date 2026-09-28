"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { getMySubmittedRequests } from "@/actions/approval.actions";

type MyRequestItem = {
  id: number;
  requestNo: string;
  title: string;
  status: string;
  businessType: string;
  currentNodeName: string | null;
  submittedAt: string;
  finishedAt: string | null;
};

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  ASSET_UPGRADE: "升级",
  ASSET_SCRAP: "报废",
  ASSET_RETURN: "退回",
  ASSET_REPLACE: "更换",
  ASSET_REPAIR: "维修",
  ASSET_DEPART: "离职",
  ASSET_PURCHASE: "加购",
};

const BUSINESS_TABS = [
  { value: "", label: "全部" },
  ...Object.entries(BUSINESS_TYPE_LABEL).map(([value, label]) => ({ value, label })),
];

const STATUS_BADGE: Record<string, { label: string; variant: "secondary" | "default" | "destructive" | "outline" }> = {
  PENDING: { label: "审批中", variant: "default" },
  APPROVED: { label: "已通过", variant: "outline" },
  REJECTED: { label: "已驳回", variant: "destructive" },
};

export function MyRequestsClient() {
  const { toast } = useToast();
  const [items, setItems] = useState<MyRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("");

  const load = useCallback(async (bizType: string) => {
    try {
      const result = await getMySubmittedRequests(
        bizType ? (bizType as Parameters<typeof getMySubmittedRequests>[0]) : undefined
      );
      if (result.success) {
        setItems(
          result.data.map((r) => ({
            ...r,
            submittedAt: r.submittedAt instanceof Date ? r.submittedAt.toISOString() : r.submittedAt,
            finishedAt:
              r.finishedAt instanceof Date ? r.finishedAt.toISOString() : r.finishedAt,
          }))
        );
      } else {
        toast({ title: "加载失败", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "加载失败", description: "加载异常，请稍后重试", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load(type);
  }, [load, type]);

  const switchType = (value: string) => {
    setType(value);
    setLoading(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="我的申请" description="我发起的申请单与流转状态" />

      <div className="flex items-center gap-2 border-b">
        {BUSINESS_TABS.map((tab) => (
          <button
            key={tab.value || "all"}
            type="button"
            onClick={() => switchType(tab.value)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              type === tab.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>申请列表</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={() => load(type)}>
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">单号</TableHead>
                <TableHead className="w-[80px]">类型</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className="w-[100px]">状态</TableHead>
                <TableHead className="w-[140px]">当前节点</TableHead>
                <TableHead className="w-[150px]">提交时间</TableHead>
                <TableHead className="w-[90px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.requestNo}</TableCell>
                  <TableCell>
                    {BUSINESS_TYPE_LABEL[r.businessType] ?? r.businessType}
                  </TableCell>
                  <TableCell>{r.title}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[r.status]?.variant ?? "secondary"}>
                      {STATUS_BADGE[r.status]?.label ?? r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{r.currentNodeName ?? "—"}</TableCell>
                  <TableCell>{formatTime(r.submittedAt)}</TableCell>
                  <TableCell>
                    <Link href={`/approvals/${r.id}`}>
                      <Button type="button" variant="outline" size="sm">
                        详情
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    {loading ? "加载中..." : "暂无申请"}
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
