import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import { getEmployeeAssets, getEmployeeById } from "@/actions/employee.actions";
import { notFound } from "next/navigation";
import { EmployeeDevicePreview } from "@/components/features/employee-device-preview";

interface EmployeeDetailPageProps {
  params: { id: string };
}

export const metadata: Metadata = { title: "员工在用设备" };

/**
 * 员工在用设备预览页（只读）：`/employees/[id]`
 *
 * 数据范围沿用 getEmployeeById 的口径：范围外员工按「不存在」处理（notFound），避免越权读取。
 */
export default async function EmployeeDetailPage({ params }: EmployeeDetailPageProps) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  const [employeeResult, assetsResult] = await Promise.all([
    getEmployeeById(id),
    getEmployeeAssets(id),
  ]);

  if (!employeeResult.success) {
    notFound();
  }

  return (
    <EmployeeDevicePreview
      employee={employeeResult.data}
      assets={assetsResult.success ? assetsResult.data : []}
    />
  );
}
