/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewRequestClient } from "@/app/(main)/approvals/new/new-request-client";
import * as approvalActions from "@/actions/approval.actions";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/actions/approval.actions", () => ({
  submitApprovalRequest: vi.fn(),
  // 提交成功后组件会查询我的待办以决定是否提醒；默认无待办
  getMyTodoTasks: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));

const assets = [
  { id: 1, assetNo: "PC-001", name: "办公笔记本" },
  { id: 2, assetNo: "PC-002", name: "设计工作站" },
];

const assetCats = [
  { assetId: 1, categoryId: 11, categoryName: "内存" },
  { assetId: 1, categoryId: 12, categoryName: "显卡" },
];

const employees = [
  { id: 7, employeeNo: "E001", name: "张三" },
  { id: 8, employeeNo: "E002", name: "李四" },
];

const delegation = [
  {
    id: 9,
    employeeNo: "E009",
    name: "王五",
    assets: [{ id: 3, assetNo: "PC-003", name: "王五电脑" }],
    assetCats: [{ assetId: 3, categoryId: 21, categoryName: "硬盘" }],
  },
];

async function pickCombobox(user: ReturnType<typeof userEvent.setup>, label: string, optionLabel: string) {
  await user.click(screen.getByRole("combobox", { name: label }));
  // 选项以「名称/姓名」为主行展示，编号/工号为副行；用正则按主行匹配
  await user.click(screen.getByRole("option", { name: new RegExp(optionLabel) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  (approvalActions.submitApprovalRequest as any).mockResolvedValue({
    success: true,
    data: { id: 100, requestNo: "AP-202609-0001" },
  });
});

afterEach(() => {
  cleanup();
});

describe("发起申请页 6 类业务类型（下拉框）", () => {
  it("业务类型为可搜索下拉，默认选升级配件并渲染设备/配件/动作控件", () => {
    render(<NewRequestClient assets={assets} assetCats={assetCats} employees={employees} />);
    const biz = screen.getByRole("combobox", { name: "选择业务类型" });
    expect(biz).toBeInTheDocument();
    // 默认升级：显示设备/配件类别/动作三个下拉
    expect(screen.getByRole("combobox", { name: "选择设备" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "选择配件类别" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "选择动作" })).toBeInTheDocument();
  });

  it("下拉用 `选择业务类型` 选中设备退回后，仅显示设备+原因", async () => {
    const user = userEvent.setup();
    render(<NewRequestClient assets={assets} assetCats={assetCats} employees={employees} />);
    await pickCombobox(user, "选择业务类型", "设备退回");
    expect(screen.queryByRole("combobox", { name: "选择配件类别" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "选择设备" })).toBeInTheDocument();
    expect(screen.getByLabelText("退回原因")).toBeInTheDocument();
  });

  it("升级：选择设备+配件类别+动作，提交 payload 含 componentCategoryId/action", async () => {
    const user = userEvent.setup();
    render(<NewRequestClient assets={assets} assetCats={assetCats} employees={employees} />);

    await user.type(screen.getByLabelText("申请标题"), "申请升级内存");
    await pickCombobox(user, "选择设备", "办公笔记本");
    await pickCombobox(user, "选择配件类别", "内存");
    await pickCombobox(user, "选择动作", "升级");
    await user.type(screen.getByLabelText("申请原因"), "内存不够用");
    await user.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() => {
      expect(approvalActions.submitApprovalRequest).toHaveBeenCalledWith({
        title: "申请升级内存",
        businessType: "ASSET_UPGRADE",
        payload: expect.objectContaining({
          assetId: 1,
          componentCategoryId: 11,
          action: "UPGRADE",
          reason: "内存不够用",
        }),
      });
    });
  });

  it("退回 tab：仅设备+原因，提交 payload 为 {assetId, reason}", async () => {
    const user = userEvent.setup();
    render(<NewRequestClient assets={assets} assetCats={assetCats} employees={employees} />);
    await pickCombobox(user, "选择业务类型", "设备退回");

    await user.type(screen.getByLabelText("申请标题"), "申请退回笔记本");
    await pickCombobox(user, "选择设备", "设计工作站");
    await user.type(screen.getByLabelText("退回原因"), "不再需要");
    await user.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() => {
      expect(approvalActions.submitApprovalRequest).toHaveBeenCalledWith({
        title: "申请退回笔记本",
        businessType: "ASSET_RETURN",
        payload: { assetId: 2, reason: "不再需要" },
      });
    });
  });

  it("更换 tab 不显示配件类别/动作，只显示设备+原因", async () => {
    const user = userEvent.setup();
    render(<NewRequestClient assets={assets} assetCats={assetCats} employees={employees} />);
    await pickCombobox(user, "选择业务类型", "更换设备");
    expect(screen.queryByRole("combobox", { name: "选择配件类别" })).toBeNull();
    expect(screen.getByLabelText("更换原因")).toBeInTheDocument();
  });

  it("离职 tab：选择离职员工，提交 payload 为 {targetEmployeeId, reason} 且不传 forEmployeeId", async () => {
    const user = userEvent.setup();
    render(<NewRequestClient assets={assets} assetCats={assetCats} employees={employees} />);
    await pickCombobox(user, "选择业务类型", "员工离职");

    // 离职不显示设备选择，代申入口也不显示
    expect(screen.queryByRole("combobox", { name: "选择设备" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "为谁申请" })).toBeNull();

    await user.type(screen.getByLabelText("申请标题"), "张三维申请离职");
    await pickCombobox(user, "选择离职员工", "张三");
    await user.type(screen.getByLabelText("离职原因"), "个人原因");
    await user.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() => {
      expect(approvalActions.submitApprovalRequest).toHaveBeenCalledWith({
        title: "张三维申请离职",
        businessType: "ASSET_DEPART",
        payload: { targetEmployeeId: 7, reason: "个人原因" },
      });
    });
  });

  it("离职 tab 未选员工时提交提示「请选择离职员工」", async () => {
    const user = userEvent.setup();
    render(<NewRequestClient assets={assets} assetCats={assetCats} employees={employees} />);
    await pickCombobox(user, "选择业务类型", "员工离职");
    await user.type(screen.getByLabelText("申请标题"), "离职");
    await user.click(screen.getByRole("button", { name: "提交申请" }));
    expect(screen.getAllByText("请选择离职员工").length).toBeGreaterThan(0);
    expect(approvalActions.submitApprovalRequest).not.toHaveBeenCalled();
  });
});

describe("重新设计：业务类型流程说明条", () => {
  it("默认升级配件展示对应流程说明", () => {
    render(<NewRequestClient assets={assets} assetCats={assetCats} employees={employees} />);
    expect(screen.getByText(/为设备申报配件升级或降级/)).toBeInTheDocument();
  });

  it("切换业务类型后流程说明随之更新", async () => {
    const user = userEvent.setup();
    render(<NewRequestClient assets={assets} assetCats={assetCats} employees={employees} />);
    await pickCombobox(user, "选择业务类型", "设备退回");
    expect(screen.getByText(/为公司设备发起退回申请/)).toBeInTheDocument();
    expect(screen.queryByText(/为设备申报配件升级或降级/)).toBeNull();
  });
});

describe("主管代员工申请（delegation）", () => {
  it("无可代申下属时不显示「为谁申请」", () => {
    render(<NewRequestClient assets={assets} assetCats={assetCats} employees={employees} />);
    expect(screen.queryByRole("combobox", { name: "为谁申请" })).toBeNull();
  });

  it("代申：选中下属后设备切换为下属设备，提交携带 forEmployeeId", async () => {
    const user = userEvent.setup();
    render(
      <NewRequestClient
        assets={assets}
        assetCats={assetCats}
        employees={employees}
        delegation={delegation}
      />
    );
    await pickCombobox(user, "选择业务类型", "资产报废");
    expect(screen.getByRole("combobox", { name: "为谁申请" })).toBeInTheDocument();

    // 选择下属王五
    await pickCombobox(user, "为谁申请", "王五");
    // 设备下拉应只剩下属设备
    await pickCombobox(user, "选择设备", "王五电脑");
    await user.type(screen.getByLabelText("申请标题"), "代报废王五电脑");
    await user.type(screen.getByLabelText("报废原因"), "主板损坏");
    await user.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() => {
      expect(approvalActions.submitApprovalRequest).toHaveBeenCalledWith({
        title: "代报废王五电脑",
        businessType: "ASSET_SCRAP",
        payload: { assetId: 3, reason: "主板损坏" },
        forEmployeeId: 9,
      });
    });
  });

  it("代申选「本人」时不携带 forEmployeeId", async () => {
    const user = userEvent.setup();
    render(
      <NewRequestClient
        assets={assets}
        assetCats={assetCats}
        employees={employees}
        delegation={delegation}
      />
    );
    // 先选业务类型再填标题：切换业务类型会清空标题
    await pickCombobox(user, "选择业务类型", "资产报废");
    await user.type(screen.getByLabelText("申请标题"), "本人报废");
    await pickCombobox(user, "选择设备", "办公笔记本");
    await user.type(screen.getByLabelText("报废原因"), "老旧");
    await user.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() => {
      expect(approvalActions.submitApprovalRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          businessType: "ASSET_SCRAP",
          payload: { assetId: 1, reason: "老旧" },
        })
      );
      // 没有不传 forEmployeeId
      const call: any = (approvalActions.submitApprovalRequest as any).mock.calls[0][0];
      expect(call.forEmployeeId).toBeUndefined();
    });
  });
});