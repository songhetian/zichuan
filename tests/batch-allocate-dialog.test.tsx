/**
 * @vitest-environment jsdom
 *
 * 批量分配弹窗（BatchAllocateDialog）与共享员工选择列表（EmployeePickList）。
 *
 * 这一版把「一次只给一个人」换成了「勾多位员工 → 与设备严格一一对应」，
 * 因此测试的重点是四件在旧实现里根本不存在的事：
 *   1. 配对顺序可见（资产编号升序 × 勾选顺序）；
 *   2. 数量不匹配时提交被闸门挡住，并说明还差几个人；
 *   3. 冲突（唯一性 / 离职）在提交前就标到具体行上；
 *   4. 部门筛选与离职禁选贯穿选择列表。
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  EmployeePickList,
  EmployeePicker,
  type PickerEmployee,
} from "@/components/features/employee-pick-list";
import { BatchAllocateDialog } from "@/components/features/batch-allocate-dialog";
import type { PairingAsset, PairingCategory } from "@/lib/allocation-pairing";

const departments = [
  { id: 1, name: "研发部" },
  { id: 2, name: "测试部" },
];

const employees: PickerEmployee[] = [
  { id: 5, name: "张三", employeeNo: "P0012", departmentId: 1, departmentName: "研发部", status: "ACTIVE" },
  { id: 6, name: "李四", employeeNo: "P0031", departmentId: 1, departmentName: "研发部", status: "ACTIVE" },
  { id: 7, name: "赵敏", employeeNo: "P0057", departmentId: 1, departmentName: "研发部", status: "LEFT" },
  { id: 8, name: "陈曦", employeeNo: "P0063", departmentId: 2, departmentName: "测试部", status: "ACTIVE" },
];

const categories: PairingCategory[] = [
  { id: 100, name: "笔记本电脑", unique: true },
  { id: 200, name: "显示器", unique: false },
];

/** 跨分类的两台闲置设备（故意打乱传入顺序，验证按资产编号升序配对） */
const mixedAssets: PairingAsset[] = [
  { id: 3, assetNo: "DN-0018", name: "笔记本 B", status: "IDLE", employeeId: null, categoryId: 200 },
  { id: 1, assetNo: "DN-0012", name: "笔记本 A", status: "IDLE", employeeId: null, categoryId: 100 },
];

/** 两台同为「笔记本电脑」（唯一分类），用于触发 R4 */
const laptopAssets: PairingAsset[] = [
  { id: 1, assetNo: "DN-0012", name: "笔记本 A", status: "IDLE", employeeId: null, categoryId: 100 },
  { id: 2, assetNo: "DN-0015", name: "笔记本 B", status: "IDLE", employeeId: null, categoryId: 100 },
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof BatchAllocateDialog>> = {}) {
  const onConfirm = vi.fn().mockResolvedValue([]);
  render(
    <BatchAllocateDialog
      open
      onOpenChange={() => {}}
      assets={mixedAssets}
      excludedCount={0}
      allAssets={mixedAssets}
      categories={categories}
      employees={employees}
      departments={departments}
      loading={false}
      onConfirm={onConfirm}
      {...overrides}
    />
  );
  return { onConfirm };
}

const pairingRows = () =>
  within(screen.getByRole("list", { name: "设备与使用人的配对结果" })).getAllByRole("listitem");

describe("EmployeePickList：部门筛选 / 搜索 / 离职禁选", () => {
  afterEach(() => cleanup());

  it("按部门筛选后只保留该部门员工", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <EmployeePickList
        employees={employees}
        departments={departments}
        selectedIds={[]}
        onToggle={onToggle}
        idPrefix="t"
      />
    );

    expect(screen.getByText("陈曦")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("测试部"));

    expect(screen.getByText("陈曦")).toBeInTheDocument();
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
  });

  it("搜索框支持按工号跨部门命中", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePickList
        employees={employees}
        departments={departments}
        selectedIds={[]}
        onToggle={vi.fn()}
        idPrefix="t"
      />
    );

    await user.type(screen.getByLabelText("搜索员工"), "P0063");

    expect(screen.getByText("陈曦")).toBeInTheDocument();
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
  });

  it("搜索框支持按部门名命中该部门所有人", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePickList
        employees={employees}
        departments={departments}
        selectedIds={[]}
        onToggle={vi.fn()}
        idPrefix="t"
      />
    );

    await user.type(screen.getByLabelText("搜索员工"), "研发");

    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("李四")).toBeInTheDocument();
    expect(screen.queryByText("陈曦")).not.toBeInTheDocument();
  });

  it("离职员工照常列出但不可勾选，并标注「已离职」", () => {
    render(
      <EmployeePickList
        employees={employees}
        departments={departments}
        selectedIds={[]}
        onToggle={vi.fn()}
        idPrefix="t"
      />
    );

    expect(screen.getByText("赵敏")).toBeInTheDocument();
    expect(screen.getByText("已离职")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "选择 赵敏" })).toBeDisabled();
  });

  it("勾选在职员工时把 id 交给宿主", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <EmployeePickList
        employees={employees}
        departments={departments}
        selectedIds={[]}
        onToggle={onToggle}
        idPrefix="t"
      />
    );

    await user.click(screen.getByRole("checkbox", { name: "选择 张三" }));

    expect(onToggle).toHaveBeenCalledWith(5);
  });
});

describe("EmployeePicker：单台场景复用同一套选择器", () => {
  afterEach(() => cleanup());

  it("可以先用部门筛选缩小范围，再选中该部门的人", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <EmployeePicker
        employees={employees}
        departments={departments}
        value={null}
        onValueChange={onValueChange}
        id="single-pick"
        ariaLabel="选择员工"
      />
    );

    await user.click(screen.getByRole("combobox", { name: "选择员工" }));
    await user.click(screen.getByRole("combobox", { name: "按部门筛选" }));
    await user.click(await screen.findByText("测试部"));
    await user.click(screen.getByRole("checkbox", { name: "选择 陈曦" }));

    expect(onValueChange).toHaveBeenCalledWith(8);
  });

  it("excludeIds 里的员工不出现在候选里（调拨排除当前使用人）", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        departments={departments}
        value={null}
        onValueChange={vi.fn()}
        id="single-pick"
        ariaLabel="目标员工"
        excludeIds={[5]}
      />
    );

    await user.click(screen.getByRole("combobox", { name: "目标员工" }));

    expect(await screen.findByText("李四")).toBeInTheDocument();
    expect(screen.queryByText("张三")).not.toBeInTheDocument();
  });
});

describe("BatchAllocateDialog：自动配对与提交闸门", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it("勾选顺序 × 资产编号升序决定配对，并原样提交给服务端", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialog();

    await user.click(screen.getByRole("checkbox", { name: "选择 张三" }));
    await user.click(screen.getByRole("checkbox", { name: "选择 李四" }));

    const rows = pairingRows();
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("DN-0012")).toBeInTheDocument();
    expect(within(rows[0]).getByText("张三")).toBeInTheDocument();
    expect(within(rows[1]).getByText("DN-0018")).toBeInTheDocument();
    expect(within(rows[1]).getByText("李四")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认分配" }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith([
        { assetId: 1, employeeId: 5 },
        { assetId: 3, employeeId: 6 },
      ])
    );
  });

  it("人不够 → 提交禁用，并说明还差几个人", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("checkbox", { name: "选择 张三" }));

    expect(screen.getByRole("button", { name: "确认分配" })).toBeDisabled();
    expect(screen.getByText("还差 1 位员工")).toBeInTheDocument();
  });

  it("人多了 → 提交禁用，并说明多选了几个人", async () => {
    const user = userEvent.setup();
    renderDialog({ assets: [mixedAssets[1]], excludedCount: 0 });

    await user.click(screen.getByRole("checkbox", { name: "选择 张三" }));
    await user.click(screen.getByRole("checkbox", { name: "选择 李四" }));

    expect(screen.getByRole("button", { name: "确认分配" })).toBeDisabled();
    expect(screen.getByText("多选了 1 位员工")).toBeInTheDocument();
  });

  it("唯一分类冲突 → 冲突行标出原因且提交被挡", async () => {
    const user = userEvent.setup();
    const held: PairingAsset = {
      id: 91,
      assetNo: "DN-0091",
      name: "旧笔记本",
      status: "IN_USE",
      employeeId: 5,
      categoryId: 100,
    };
    renderDialog({
      assets: laptopAssets,
      allAssets: [...laptopAssets, held],
      onConfirm: vi.fn().mockResolvedValue([]),
    });

    await user.click(screen.getByRole("checkbox", { name: "选择 张三" }));
    await user.click(screen.getByRole("checkbox", { name: "选择 李四" }));

    expect(screen.getByText(/已持有「笔记本电脑」DN-0091/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认分配" })).toBeDisabled();
    expect(screen.getByText("有 1 对存在冲突")).toBeInTheDocument();
  });

  it("摘除某人后重新配对，并如实提示剩余待配对数", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("checkbox", { name: "选择 张三" }));
    await user.click(screen.getByRole("checkbox", { name: "选择 李四" }));

    const firstRow = pairingRows()[0];
    await user.click(within(firstRow).getByRole("button", { name: "摘除" }));

    const rows = pairingRows();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("DN-0012")).toBeInTheDocument();
    expect(within(rows[0]).getByText("李四")).toBeInTheDocument();
    expect(screen.getByText("还有 1 台设备待配对")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认分配" })).toBeDisabled();
  });

  it("逐行换人 → 与目标行交换使用人，仍保持一一对应", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("checkbox", { name: "选择 张三" }));
    await user.click(screen.getByRole("checkbox", { name: "选择 李四" }));

    await user.click(screen.getByRole("button", { name: "为第 1 台设备换人" }));
    await user.click(await screen.findByRole("button", { name: /李四/ }));

    const rows = pairingRows();
    expect(within(rows[0]).getByText("李四")).toBeInTheDocument();
    expect(within(rows[1]).getByText("张三")).toBeInTheDocument();
  });

  it("服务端拒绝时把结构化原因回填到同一行，并继续挡住提交", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue([
      {
        assetId: 1,
        assetNo: "DN-0012",
        employeeId: 5,
        employeeName: "张三",
        reason: "张三 已持有「笔记本电脑」DN-0091，该分类每人限 1 台",
      },
    ]);
    renderDialog({ onConfirm });

    await user.click(screen.getByRole("checkbox", { name: "选择 张三" }));
    await user.click(screen.getByRole("checkbox", { name: "选择 李四" }));

    await user.click(screen.getByRole("button", { name: "确认分配" }));

    expect(await screen.findByText(/已持有「笔记本电脑」DN-0091/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认分配" })).toBeDisabled();
  });

  it("被排除的设备数量如实告知，不再让文案说谎", () => {
    renderDialog({ assets: [mixedAssets[1]], excludedCount: 4 });

    expect(
      screen.getByText(/另有 4 台所选设备不是「闲置」状态，未纳入本次分配/)
    ).toBeInTheDocument();
  });
});
