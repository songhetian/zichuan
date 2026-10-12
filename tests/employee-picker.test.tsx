/**
 * EmployeePicker —— 全站统一的选人控件（单选）。
 *
 * 固定两行：第一行「选择部门」下拉 → 第二行「选择员工」。
 * 解决「选员工要翻全量列表」：先按部门收窄，再按关键字（姓名/工号/部门）搜。
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeePicker } from "@/components/ui/employee-picker";

// 部门下拉由 employees 推导，无需单独传 departments
const employees = [
  { id: 11, name: "李四", employeeNo: "EMP0011", departmentId: 1, departmentName: "研发部" },
  { id: 12, name: "王五", employeeNo: "EMP0012", departmentId: 1, departmentName: "研发部" },
  { id: 21, name: "赵六", employeeNo: "EMP0021", departmentId: 2, departmentName: "市场部" },
];

type User = ReturnType<typeof userEvent.setup>;

async function openEmployees(user: User, placeholder = "请选择员工") {
  await user.click(screen.getByRole("combobox", { name: placeholder }));
}

async function pickDepartment(user: User, name: string) {
  await user.click(screen.getByRole("combobox", { name: "选择部门" }));
  await user.click(screen.getByText(name));
}

describe("EmployeePicker 单选", () => {
  it("分两行：第一行选择部门，第二行选择员工", () => {
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择员工"
      />
    );

    expect(screen.getByText("选择部门")).toBeInTheDocument();
    expect(screen.getByText("选择员工")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "选择部门" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "请选择员工" })).toBeInTheDocument();
  });

  it("第二行的标题可以用 employeeLabel 改写（调拨场景叫「目标员工」）", () => {
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择目标员工"
        employeeLabel="目标员工"
      />
    );

    expect(screen.getByText("目标员工")).toBeInTheDocument();
    expect(screen.queryByText("选择员工")).toBeNull();
  });

  it("展开后列出全部员工，并显示工号与部门", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择员工"
      />
    );

    await openEmployees(user);

    expect(screen.getByRole("option", { name: /李四/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /王五/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /赵六/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /李四/ })).toHaveTextContent("EMP0011");
    expect(screen.getByRole("option", { name: /李四/ })).toHaveTextContent("研发部");
  });

  it("点击员工回传其 id 并收起", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={onValueChange}
        placeholder="请选择员工"
      />
    );

    await openEmployees(user);
    await user.click(screen.getByRole("option", { name: /赵六/ }));

    expect(onValueChange).toHaveBeenCalledWith("21");
    expect(screen.queryByRole("option", { name: /李四/ })).toBeNull();
  });

  it("已选中时触发按钮显示「姓名 · 部门」", () => {
    render(
      <EmployeePicker
        employees={employees}
        value="11"
        onValueChange={() => {}}
        placeholder="请选择员工"
      />
    );

    expect(screen.getByRole("combobox", { name: "请选择员工" })).toHaveTextContent("李四 · 研发部");
  });

  it("第一行选中部门后，第二行的员工只剩该部门的人", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择员工"
      />
    );

    await pickDepartment(user, "研发部");
    await openEmployees(user);

    expect(screen.getByRole("option", { name: /李四/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /王五/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /赵六/ })).toBeNull();
  });

  it("部门选回「全部部门」时恢复全部员工", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择员工"
      />
    );

    await pickDepartment(user, "研发部");
    await pickDepartment(user, "全部部门");
    await openEmployees(user);

    expect(screen.getByRole("option", { name: /赵六/ })).toBeInTheDocument();
  });

  it("关键字按姓名过滤", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择员工"
      />
    );

    await openEmployees(user);
    await user.type(screen.getByPlaceholderText("搜索姓名 / 工号 / 部门"), "王五");

    expect(screen.getByRole("option", { name: /王五/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /李四/ })).toBeNull();
  });

  it("关键字按工号过滤", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择员工"
      />
    );

    await openEmployees(user);
    await user.type(screen.getByPlaceholderText("搜索姓名 / 工号 / 部门"), "EMP0021");

    expect(screen.getByRole("option", { name: /赵六/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /李四/ })).toBeNull();
  });

  it("关键字按部门名搜出该部门全部员工", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择员工"
      />
    );

    await openEmployees(user);
    await user.type(screen.getByPlaceholderText("搜索姓名 / 工号 / 部门"), "研发");

    expect(screen.getByRole("option", { name: /李四/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /王五/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /赵六/ })).toBeNull();
  });

  it("部门筛选与关键字同时生效（交集）", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择员工"
      />
    );

    await pickDepartment(user, "研发部");
    await openEmployees(user);
    await user.type(screen.getByPlaceholderText("搜索姓名 / 工号 / 部门"), "王");

    expect(screen.getByRole("option", { name: /王五/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /李四/ })).toBeNull();
    expect(screen.queryByRole("option", { name: /赵六/ })).toBeNull();
  });

  it("无匹配时显示空态文案", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择员工"
        emptyText="没有找到员工"
      />
    );

    await openEmployees(user);
    await user.type(screen.getByPlaceholderText("搜索姓名 / 工号 / 部门"), "不存在的人");

    expect(screen.getByText("没有找到员工")).toBeInTheDocument();
  });

  it("排除的员工（调拨时排除当前使用人）不会出现在列表里", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择目标员工"
        employeeLabel="目标员工"
        excludeIds={[11]}
      />
    );

    await openEmployees(user, "请选择目标员工");

    expect(screen.queryByRole("option", { name: /李四/ })).toBeNull();
    expect(screen.getByRole("option", { name: /王五/ })).toBeInTheDocument();
  });

  it("收起再展开时筛选条件被重置，不会残留上次的搜索词/部门", async () => {
    const user = userEvent.setup();
    render(
      <EmployeePicker
        employees={employees}
        value=""
        onValueChange={() => {}}
        placeholder="请选择员工"
      />
    );

    await openEmployees(user);
    await user.type(screen.getByPlaceholderText("搜索姓名 / 工号 / 部门"), "王五");
    expect(screen.queryByRole("option", { name: /李四/ })).toBeNull();

    // 关闭再打开
    await user.keyboard("{Escape}");
    await openEmployees(user);

    expect(screen.getByRole("option", { name: /李四/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索姓名 / 工号 / 部门")).toHaveValue("");
  });
});
