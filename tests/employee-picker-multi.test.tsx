/**
 * EmployeePicker 多选模式 —— 批量分配弹窗左侧的选人面板。
 * 结构刻意拆成两行：第一行「选择部门」，第二行「选择员工（可多选）」。
 * 内联呈现（不是 Popover）：部门下拉 + 关键字 + 全选当前结果 + 复选列表 + 已选 chips。
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeePicker } from "@/components/ui/employee-picker";

const employees = [
  { id: 11, name: "李四", employeeNo: "EMP0011", departmentId: 1, departmentName: "研发部" },
  { id: 12, name: "王五", employeeNo: "EMP0012", departmentId: 1, departmentName: "研发部" },
  { id: 21, name: "赵六", employeeNo: "EMP0021", departmentId: 2, departmentName: "市场部" },
];

const departmentSelect = () => screen.getByRole("combobox", { name: "选择部门" });

/** 选部门：打开部门下拉，点中该部门（cmdk 以 label 作为 option 名） */
async function pickDepartment(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(departmentSelect());
  await user.click(await screen.findByRole("option", { name }));
}

function renderPicker(onValueChange: (v: number[]) => void, value: number[] = []) {
  return render(
    <EmployeePicker
      mode="multiple"
      employees={employees}
      value={value}
      onValueChange={onValueChange}
    />
  );
}

describe("EmployeePicker 多选", () => {
  it("拆成两行：第一行选择部门，第二行选择员工", () => {
    renderPicker(() => {});

    expect(screen.getByText("选择部门")).toBeInTheDocument();
    expect(screen.getByText("选择员工（可多选）")).toBeInTheDocument();
    // 部门默认「全部部门」，员工名单一次列全
    expect(departmentSelect()).toHaveTextContent("全部部门");
    expect(screen.getByRole("checkbox", { name: "李四" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "赵六" })).toBeInTheDocument();
  });

  it("勾选员工回传 id 数组", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderPicker(onValueChange);

    await user.click(screen.getByRole("checkbox", { name: "赵六" }));

    expect(onValueChange).toHaveBeenCalledWith([21]);
  });

  it("取消勾选后从数组中移除该 id", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderPicker(onValueChange, [11, 21]);

    await user.click(screen.getByRole("checkbox", { name: "李四" }));

    expect(onValueChange).toHaveBeenCalledWith([21]);
  });

  it("点击整行（不只是复选框）只切换一次勾选", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderPicker(onValueChange);

    await user.click(screen.getByText("赵六"));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith([21]);
  });

  it("已选员工显示为 chip，点 × 可移除", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderPicker(onValueChange, [11, 21]);

    expect(screen.getByText("已选 2 人")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "移除 李四" }));

    expect(onValueChange).toHaveBeenCalledWith([21]);
  });

  it("「清空」一次清掉全部已选", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderPicker(onValueChange, [11, 21]);

    await user.click(screen.getByRole("button", { name: "清空" }));

    expect(onValueChange).toHaveBeenCalledWith([]);
  });

  it("先选部门：名单只保留该部门员工", async () => {
    const user = userEvent.setup();
    renderPicker(() => {});

    await pickDepartment(user, "研发部");

    expect(screen.getByRole("checkbox", { name: "李四" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "王五" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "赵六" })).toBeNull();
  });

  it("再选「全部部门」时名单恢复完整", async () => {
    const user = userEvent.setup();
    renderPicker(() => {});

    await pickDepartment(user, "研发部");
    await pickDepartment(user, "全部部门");

    expect(screen.getByRole("checkbox", { name: "赵六" })).toBeInTheDocument();
  });

  it("关键字可按姓名或工号过滤", async () => {
    const user = userEvent.setup();
    renderPicker(() => {});

    await user.type(screen.getByLabelText("搜索姓名 / 工号 / 部门"), "EMP0021");

    expect(screen.getByRole("checkbox", { name: "赵六" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "李四" })).toBeNull();
  });

  it("「全选当前结果」把筛选出的员工一次勾上，再点一次全部取消", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderPicker(onValueChange);

    await pickDepartment(user, "研发部");
    await user.click(screen.getByRole("button", { name: "全选当前结果（2 人）" }));

    expect(onValueChange).toHaveBeenCalledWith([11, 12]);
  });

  it("全部已选时再点「全选当前结果」会取消这些人的勾选", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderPicker(onValueChange, [11, 12]);

    await pickDepartment(user, "研发部");
    await user.click(screen.getByRole("button", { name: "全选当前结果（2 人）" }));

    expect(onValueChange).toHaveBeenCalledWith([]);
  });

  it("已持有该唯一分类的员工就地标出原因，不必等到预览里才发现", () => {
    render(
      <EmployeePicker
        mode="multiple"
        employees={employees}
        value={[]}
        onValueChange={() => {}}
        unavailableReasons={new Map([[11, "已持有电脑主机"]])}
      />
    );

    expect(screen.getByText("已持有电脑主机")).toBeInTheDocument();
    // 其余员工不带标记
    expect(screen.getByRole("checkbox", { name: "赵六" })).toBeInTheDocument();
  });
});
