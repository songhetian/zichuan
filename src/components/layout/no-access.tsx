import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/** 无权限访问提示（路由拦截时展示） */
export function NoAccess() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <ShieldAlert className="h-12 w-12 text-muted-foreground" />
      <p className="text-lg font-medium text-foreground">无访问权限</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        当前账号没有访问该页面的权限，如有需要请联系管理员开通。
      </p>
      <Button asChild size="sm">
        <Link href="/dashboard">返回首页</Link>
      </Button>
    </div>
  );
}