import { Skeleton } from "@/components/ui/skeleton"

/** 员工在用设备预览页骨架屏（与员工列表页同构，减少跳转时的空白感） */
export default function EmployeeDeviceLoading() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-md" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      {/* 基本信息 */}
      <Skeleton className="h-5 w-40" />

      {/* 概览 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[70px] rounded-lg" />
        ))}
      </div>

      {/* 设备列表 */}
      <div className="rounded-lg border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 border-b p-4 last:border-b-0">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72" />
          </div>
        ))}
      </div>
    </div>
  )
}
