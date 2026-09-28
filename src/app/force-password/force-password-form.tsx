"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { forceChangePassword } from "@/actions/auth.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function ForcePasswordForm({ displayName }: { displayName: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("新密码至少 6 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }

    setLoading(true);
    try {
      const result = await forceChangePassword({ newPassword: password });
      if (result.success) {
        toast({ title: "密码修改成功" });
        router.replace("/dashboard");
      } else {
        setError(result.error ?? "修改失败");
      }
    } catch {
      setError("修改失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-28 -left-24 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
      </div>
      <Card className="w-[400px]">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <KeyRound className="h-8 w-8" />
            </div>
          </div>
          <CardTitle className="font-display text-2xl">首次登录需修改密码</CardTitle>
          <CardDescription>
            您好，{displayName}。当前使用的是初始密码，请设置一个新密码后继续。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">新密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位，不能与默认密码相同"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">确认新密码</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再次输入新密码"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "保存中..." : "保存并进入系统"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
