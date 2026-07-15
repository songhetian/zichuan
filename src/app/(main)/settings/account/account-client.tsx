"use client";

import { useState } from "react";
import { PageHeader } from "@/components/features/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { changePassword } from "@/actions/auth.actions";

export function AccountClient() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) {
      toast({ title: "请填写完整信息", variant: "destructive" });
      return;
    }
    setLoading(true);
    const result = await changePassword({ oldPassword, newPassword });
    setLoading(false);
    if (result.success) {
      toast({ title: "密码修改成功" });
      setOldPassword("");
      setNewPassword("");
    } else {
      toast({ title: "修改失败", description: result.error, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="账号设置"
        description="管理账号密码"
      />

      <Card>
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label>旧密码</Label>
            <Input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="请输入旧密码"
            />
          </div>
          <div className="space-y-2">
            <Label>新密码</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="请输入新密码"
            />
          </div>
          <Button onClick={handleChangePassword} disabled={loading || !oldPassword || !newPassword}>
            {loading ? "修改中..." : "确认修改"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}