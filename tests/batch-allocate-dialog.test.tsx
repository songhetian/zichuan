/**
 * BatchAllocateDialog —— 批量分配弹窗的端到端链路。
 * 验证「多选员工 → 均值分配预览 → 只提交可行的分配」这条主流程真的接通了。
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/actions/lifecycle.actions", () => ({
  allocateAssetsToEmployees: vi.fn(),
}));

import { allocateAssetsToEmployees } from "@/actions/lifecycle.actions";
import { BatchAllocateDialog } from "@/app/(main)/assets/batch-allocate-dialog";

const mockedAllocate = vi.mocked(allocateAssetsToEmployees);

const employees = [
  { id: 11, name: "李四", employeeNo: "EMP0011", departmentId: 1, departmentName: "研发部" },
  { id: 12, name: "王五", employeeNo: "EMP0012", departmentId: 1, departmentName: "研发部" },
];

const categories = [{ id: 1, name: "笔记本电脑", unique: true }];

function laptop(id: number, assetNo: string) {
  return {
    id,
    assetNo,
    status: "IN_STOCK",
    categoryId: 1,
    categoryName: "笔记本电脑",
    employeeId: null,
  };
}

const assets = [laptop(1, "DN-0001"), laptop(2, "DN-0002"), laptop(3, "DN-0003")];

function renderDialog(overrides: Partial<Parameters<typeof BatchAllocateDialog>[0]> = {}) {
  return render(
    <BatchAllocateDialog
      open
      onOpenChange={() => {}}
      assets={assets}
      employees={employees}
      categories={categories}
      employeeOwnedUniqueCategories={new Map()}
      onAllocated={() => {}}
      {...overrides}
    />
  );
}

describe("BatchAllocateDialog", () => {
  beforeEach(() => {
    mockedAllocate.mockReset();
  });

  it("多选员工后给出均值分配预览，提交只发送可行的分配", async () => {
    const user = userEvent.setup();
    mockedAllocate.mockResolvedValue({
      success: true,
      data: { allocatedCount: 2, skipped: [{ assetId: 3, assetNo: "DN-0003", reason: "名额不足" }] },
    });

    renderDialog();

    await user.click(screen.getByRole("checkbox", { name: "李四" }));
    await user.click(screen.getByRole("checkbox", { name: "王五" }));

    // 唯一分类 + 2 人 → 每人 1 台，第 3 台无槽位
    expect(screen.getByText("可分配 2 台")).toBeInTheDocument();
    expect(screen.getByText("冲突 1 台")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "分配可用的 2 台" }));

    await waitFor(() => expect(mockedAllocate).toHaveBeenCalledTimes(1));
    expect(mockedAllocate.mock.calls[0][0]).toEqual({
      assignments: [
        { assetId: 1, employeeId: 11 },
        { assetId: 2, employeeId: 12 },
      ],
      operator: "admin",
      remark: "批量分配",
    });
  });

  it("员工已持有同类唯一设备时标出原因，且不顺延给下一个人", async () => {
    const user = userEvent.setup();
    mockedAllocate.mockResolvedValue({
      success: true,
      data: { allocatedCount: 1, skipped: [] },
    });

    // 李四（槽位第 1 个）已持有一台笔记本电脑
    renderDialog({ employeeOwnedUniqueCategories: new Map([[11, [1]]]) });

    await user.click(screen.getByRole("checkbox", { name: "李四" }));
    await user.click(screen.getByRole("checkbox", { name: "王五" }));

    expect(screen.getByText("可分配 1 台")).toBeInTheDocument();
    expect(screen.getByText("冲突 2 台")).toBeInTheDocument();
    expect(screen.getByText("李四已持有笔记本电脑")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "分配可用的 1 台" }));

    await waitFor(() => expect(mockedAllocate).toHaveBeenCalledTimes(1));
    // DN-0001 落在李四的无效槽位 → 跳过；DN-0002 给王五；DN-0003 无槽位
    expect(mockedAllocate.mock.calls[0][0].assignments).toEqual([
      { assetId: 2, employeeId: 12 },
    ]);
  });

  it("选中的员工多于设备台数时给出提示并禁止提交", async () => {
    const user = userEvent.setup();

    renderDialog({ assets: [laptop(1, "DN-0001")] });

    await user.click(screen.getByRole("checkbox", { name: "李四" }));
    await user.click(screen.getByRole("checkbox", { name: "王五" }));

    expect(screen.getByText(/多于 1 台设备/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "没有可分配的设备" })).toBeDisabled();
    expect(mockedAllocate).not.toHaveBeenCalled();
  });
});
