/**
 * AllocationPreview —— 批量分配弹窗右侧的分配预览。
 * 「谁拿几台 + 冲突几台 + 为什么冲突」，是「跳过冲突只分可行的」这个语义能被用户
 * 看懂的唯一出口（均值分配 + 唯一封顶后，可分配台数常低于选中台数）。
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AllocationPreview, buildAllocateSubmitLabel } from "@/components/features/allocation-preview";
import type { AllocationPlan } from "@/lib/allocation";

const employees = [
  { id: 1, name: "张三", employeeNo: "E001", departmentId: 1, departmentName: "研发部" },
  { id: 2, name: "李四", employeeNo: "E002", departmentId: 1, departmentName: "研发部" },
];

const plan: AllocationPlan = {
  assignments: [{ assetId: 2, employeeId: 2 }],
  conflicts: [{ assetId: 1, assetNo: "DN-0001", reason: "张三已持有笔记本电脑" }],
  perEmployee: [
    { employeeId: 1, count: 0 },
    { employeeId: 2, count: 1 },
  ],
};

describe("AllocationPreview", () => {
  it("列出每位选中员工分到的台数（含 0 台）", () => {
    render(<AllocationPreview plan={plan} employees={employees} />);

    const rows = within(screen.getByRole("list", { name: "分配预览" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("张三 · 研发部");
    expect(rows[0]).toHaveTextContent("0 台");
    expect(rows[1]).toHaveTextContent("李四 · 研发部");
    expect(rows[1]).toHaveTextContent("1 台");
  });

  it("汇总可分配与冲突台数，并按原因归并冲突、列出编号", () => {
    render(<AllocationPreview plan={plan} employees={employees} />);

    expect(screen.getByText("可分配 1 台")).toBeInTheDocument();
    expect(screen.getByText("冲突 1 台")).toBeInTheDocument();

    const conflicts = within(screen.getByRole("list", { name: "冲突明细" })).getAllByRole(
      "listitem"
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toHaveTextContent("张三已持有笔记本电脑");
    expect(conflicts[0]).toHaveTextContent("（1 台）");
    expect(conflicts[0]).toHaveTextContent("DN-0001");
  });

  it("同一原因的多台冲突合并成一条，并列出全部编号", () => {
    const reason = "笔记本电脑可分配名额不足";
    const multi: AllocationPlan = {
      assignments: [],
      conflicts: [
        { assetId: 1, assetNo: "DN-0001", reason },
        { assetId: 2, assetNo: "DN-0002", reason },
      ],
      perEmployee: [],
    };

    render(<AllocationPreview plan={multi} employees={employees} />);

    const conflicts = within(screen.getByRole("list", { name: "冲突明细" })).getAllByRole(
      "listitem"
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toHaveTextContent("（2 台）");
    expect(conflicts[0]).toHaveTextContent("DN-0001、DN-0002");
  });

  it("无冲突时不显示冲突区", () => {
    const clean: AllocationPlan = {
      assignments: [{ assetId: 1, employeeId: 1 }],
      conflicts: [],
      perEmployee: [{ employeeId: 1, count: 1 }],
    };

    render(<AllocationPreview plan={clean} employees={employees} />);

    expect(screen.getByText("可分配 1 台")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "冲突明细" })).toBeNull();
  });

  it("全部冲突时额外说明「当前没有可分配的设备」，已持有场景给出明确下一步", () => {
    const none: AllocationPlan = {
      assignments: [],
      conflicts: [
        { assetId: 1, assetNo: "DN-0001", reason: "张三已持有笔记本电脑" },
        { assetId: 2, assetNo: "DN-0002", reason: "笔记本电脑每人仅限 1 台" },
      ],
      perEmployee: [{ employeeId: 1, count: 0 }],
    };

    render(<AllocationPreview plan={none} employees={employees} />);

    expect(screen.getByText(/当前没有可分配的设备/)).toBeInTheDocument();
    expect(screen.getByText(/先归还现有设备/)).toBeInTheDocument();
  });

  it("确认按钮文案写明实际会分配几台", () => {
    expect(buildAllocateSubmitLabel(4)).toBe("分配可用的 4 台");
    expect(buildAllocateSubmitLabel(0)).toBe("没有可分配的设备");
  });
});
