/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowsClient } from "@/app/(main)/settings/workflows/workflows-client";
import * as workflowActions from "@/actions/workflow.actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/actions/workflow.actions", () => ({
  getWorkflowDefinitions: vi.fn(),
  getWorkflowDefinition: vi.fn(),
  getWorkflowConfigSummary: vi.fn(),
  createWorkflowDefinition: vi.fn(),
  addWorkflowNode: vi.fn(),
  updateWorkflowNode: vi.fn(),
  removeWorkflowNode: vi.fn(),
  duplicateWorkflowNode: vi.fn(),
  reorderWorkflowNodes: vi.fn(),
  publishWorkflowDefinition: vi.fn(),
  duplicateWorkflowDefinition: vi.fn(),
  removeWorkflowDraft: vi.fn(),
  activateWorkflowVersion: vi.fn(),
}));

const definitions = [
  {
    id: 1,
    name: "升级配件流程",
    version: 1,
    status: "PUBLISHED",
    publishedAt: "2026-09-19T00:00:00.000Z",
    nodeCount: 2,
  },
  {
    id: 2,
    name: "升级配件流程 v2",
    version: 2,
    status: "DRAFT",
    publishedAt: null,
    nodeCount: 1,
  },
];

const detail2 = {
  id: 2,
  name: "升级配件流程 v2",
  businessType: "ASSET_UPGRADE",
  version: 2,
  status: "DRAFT",
  publishedAt: null,
  nodes: [
    {
      id: 21,
      nodeKey: "n1",
      name: "部门主管审批",
      sortOrder: 0,
      assigneeType: "DEPT_MANAGER",
      assigneeUserId: null,
      assigneeRole: null,
      initiatorCanChoose: false,
      multiMode: "ANY",
      ccType: "INITIATOR",
      ccUserIds: null,
    },
    {
      id: 22,
      nodeKey: "n2",
      name: "资产管理员审批",
      sortOrder: 1,
      assigneeType: "ROLE",
      assigneeUserId: null,
      assigneeRole: "ASSET_MANAGER",
      initiatorCanChoose: false,
      multiMode: "ANY",
      ccType: "NONE",
      ccUserIds: null,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("流程配置界面", () => {
  it("渲染流程版本列表（名称/版本/状态徽标/节点数）", async () => {
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    expect(screen.getByText("升级配件流程")).toBeInTheDocument();
    expect(screen.getByText("升级配件流程 v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("v2")).toBeInTheDocument();
    // 状态徽标：生效 / 草稿
    expect(screen.getByText("生效")).toBeInTheDocument();
    expect(screen.getByText("草稿")).toBeInTheDocument();
    // 节点数
    expect(screen.getAllByText("2")).toHaveLength(1);
    expect(screen.getAllByText("1")).toHaveLength(1);
  });

  it("新建版本：填名称后调用 createWorkflowDefinition（带默认节点）", async () => {
    const user = userEvent.setup();
    (workflowActions.createWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: { id: 3, name: "升级配件流程 v3", version: 3, status: "DRAFT" },
    });
    (workflowActions.getWorkflowDefinitions as any).mockResolvedValue({
      success: true,
      data: definitions,
    });
    (workflowActions.getWorkflowConfigSummary as any).mockResolvedValue({
      success: true,
      data: {
        ASSET_UPGRADE: { total: 2, published: 1 },
        ASSET_SCRAP: { total: 1, published: 1 },
      },
    });
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    await user.click(screen.getByRole("button", { name: "新建版本" }));
    await user.type(screen.getByLabelText("流程名称"), "升级配件流程 v3");
    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(workflowActions.createWorkflowDefinition).toHaveBeenCalledWith({
        businessType: "ASSET_UPGRADE",
        name: "升级配件流程 v3",
        nodes: [
          {
            name: "部门主管审批",
            assigneeType: "DEPT_MANAGER",
            ccType: "INITIATOR",
          },
        ],
      });
    });
    expect(workflowActions.getWorkflowDefinitions).toHaveBeenCalled();
  });

  it("新建版本：可选流程类型，且已配置类型显示提示", async () => {
    const user = userEvent.setup();
    (workflowActions.createWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: { id: 3, name: "资产报废流程 v1", version: 1, status: "DRAFT" },
    });
    (workflowActions.getWorkflowDefinitions as any).mockResolvedValue({
      success: true,
      data: definitions,
    });
    (workflowActions.getWorkflowConfigSummary as any).mockResolvedValue({
      success: true,
      data: {
        ASSET_UPGRADE: { total: 2, published: 1 },
        ASSET_SCRAP: { total: 1, published: 1 },
      },
    });
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    await user.click(screen.getByRole("button", { name: "新建版本" }));
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "资产报废" }));
    await user.type(screen.getByLabelText("流程名称"), "资产报废流程 v1");

    expect(await screen.findByText(/已有 1 个版本/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "创建" }));
    await waitFor(() => {
      expect(workflowActions.createWorkflowDefinition).toHaveBeenCalledWith(
        expect.objectContaining({ businessType: "ASSET_SCRAP", name: "资产报废流程 v1" })
      );
    });
  });

  it("编辑：点击列表编辑加载并渲染节点链（审批人/抄送描述）", async () => {
    const user = userEvent.setup();
    (workflowActions.getWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: detail2,
    });
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    await user.click(screen.getByText("升级配件流程 v2"));

    await waitFor(() => {
      expect(workflowActions.getWorkflowDefinition).toHaveBeenCalledWith(2);
    });
    expect(await screen.findByText("部门主管审批")).toBeInTheDocument();
    expect(screen.getByText("资产管理员审批")).toBeInTheDocument();
    expect(screen.getAllByText(/部门主管/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/发起人本人/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/或签/).length).toBeGreaterThan(0);
    expect(screen.getByText("按角色（资产管理员）")).toBeInTheDocument();
  });

  it("添加节点：填表单后调用 addWorkflowNode", async () => {
    const user = userEvent.setup();
    (workflowActions.getWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: detail2,
    });
    (workflowActions.addWorkflowNode as any).mockResolvedValue({
      success: true,
      data: { id: 22 },
    });
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    await user.click(screen.getByText("升级配件流程 v2"));
    await screen.findByText("部门主管审批");

    await user.click(screen.getByRole("button", { name: "添加节点" }));
    await user.type(screen.getByLabelText("节点名称"), "资产管理员审批");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(workflowActions.addWorkflowNode).toHaveBeenCalledWith(2, {
        name: "资产管理员审批",
        assigneeType: "DEPT_MANAGER",
        assigneeRole: undefined,
        multiMode: "ANY",
        ccType: "NONE",
        ccRules: [],
      });
    });
  });

  it("删除节点：调用 removeWorkflowNode", async () => {
    const user = userEvent.setup();
    (workflowActions.getWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: detail2,
    });
    (workflowActions.removeWorkflowNode as any).mockResolvedValue({
      success: true,
      data: { id: 21 },
    });
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    await user.click(screen.getByText("升级配件流程 v2"));
    await screen.findByText("部门主管审批");

    await user.click(screen.getAllByTitle("删除节点")[0]);
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(workflowActions.removeWorkflowNode).toHaveBeenCalledWith(21);
    });
  });

  it("编辑节点：可配置抄送规则并随保存提交 ccRules", async () => {
    const user = userEvent.setup();
    (workflowActions.getWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: detail2,
    });
    (workflowActions.updateWorkflowNode as any).mockResolvedValue({
      success: true,
      data: { id: 21 },
    });
    (workflowActions.getWorkflowDefinition as any)
      .mockResolvedValueOnce({ success: true, data: detail2 })
      .mockResolvedValue({ success: true, data: detail2 });
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    await user.click(screen.getByText("升级配件流程 v2"));
    await screen.findByText("部门主管审批");

    // 编辑首个节点（detail2.n1 历史 ccType=INITIATOR，会被自动迁移进 ccRules）
    await user.click(screen.getAllByTitle("编辑节点")[0]);
    await user.click(screen.getByRole("button", { name: "添加规则" }));
    // 再加一条 ROLE 规则
    await user.click(screen.getByRole("button", { name: "添加规则" }));
    // cc 规则类型下拉（SearchableSelect 无 aria-label，按文本内容取当前均为「发起人本人」的三条）
    const ruleTypeSelects = screen
      .getAllByRole("combobox")
      .filter((el) => el.textContent === "发起人本人");
    await user.click(ruleTypeSelects[2]);
    await user.click(screen.getByText("按角色"));
    const roleSelect = screen
      .getAllByRole("combobox")
      .find((el) => el.textContent === "选择角色");
    await user.click(roleSelect!);
    await user.click(screen.getByText("资产管理员"));

    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(workflowActions.updateWorkflowNode).toHaveBeenCalledWith(
        21,
        expect.objectContaining({
          ccType: "NONE",
          ccRules: expect.arrayContaining([
            { type: "INITIATOR" },
            { type: "ROLE", roleKey: "ASSET_MANAGER" },
          ]),
        })
      );
    });
  });

  it("报废流程草稿：节点页具备拖拽排序源 + 编辑/删除按钮（与其他类型一致）", async () => {
    const user = userEvent.setup();
    const scrapDetail = {
      id: 9,
      name: "资产报废流程",
      businessType: "ASSET_SCRAP",
      version: 1,
      status: "DRAFT",
      publishedAt: null,
      nodes: [
        {
          id: 91,
          nodeKey: "n1",
          name: "部门主管审批",
          sortOrder: 0,
          assigneeType: "DEPT_MANAGER",
          assigneeUserId: null,
          assigneeRole: null,
          initiatorCanChoose: false,
          multiMode: "ANY",
          ccType: "INITIATOR",
          ccUserIds: null,
        },
        {
          id: 92,
          nodeKey: "n2",
          name: "资产管理员审批",
          sortOrder: 1,
          assigneeType: "ROLE",
          assigneeUserId: null,
          assigneeRole: "ASSET_MANAGER",
          initiatorCanChoose: false,
          multiMode: "ANY",
          ccType: "NONE",
          ccUserIds: null,
        },
      ],
    };
    (workflowActions.getWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: scrapDetail,
    });
    (workflowActions.removeWorkflowNode as any).mockResolvedValue({
      success: true,
      data: { id: 92 },
    });
    render(
      <WorkflowsClient
        initialDefinitions={
          [
            { id: 9, name: "资产报废流程", version: 1, status: "DRAFT", publishedAt: null, nodeCount: 2 },
          ] as never
        }
      />
    );

    await user.click(screen.getByText("资产报废流程"));
    await screen.findByText("部门主管审批");

    // 节点侧具备拖拽排序源（⠿）与编辑/删除按钮
    expect(screen.getAllByTitle("拖拽排序").length).toBe(2);
    expect(screen.getAllByTitle("编辑节点").length).toBe(2);
    expect(screen.getAllByTitle("删除节点").length).toBe(2);

    // 上移/下移可用（首节点上移禁用）
    expect(screen.getAllByTitle("上移")).toHaveLength(2);
    await user.click(screen.getAllByTitle("删除节点")[1]);
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => {
      expect(workflowActions.removeWorkflowNode).toHaveBeenCalledWith(92);
    });
  });

  it("升级：末节点资产管理员被固定（徽标展示、删除/上移禁用、无拖拽把手）", async () => {
    const user = userEvent.setup();
    (workflowActions.getWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: detail2,
    });
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    await user.click(screen.getByText("升级配件流程 v2"));
    await screen.findByText("部门主管审批");

    // 末节点资产管理员卡片带徽标
    expect(screen.getByText("末节点·资产管理员")).toBeInTheDocument();

    // 仅首节点可拖拽（末节点固定，出现 1 个拖拽把手）
    expect(screen.getAllByTitle("拖拽排序")).toHaveLength(1);

    // 末节点（资产管理员）上移/删除均禁用，首节点删除可用
    const upButtons = screen.getAllByTitle("上移");
    const delButtons = screen.getAllByTitle("删除节点");
    expect(upButtons[1]).toBeDisabled();
    expect(delButtons[1]).toBeDisabled();
    expect(delButtons[0]).not.toBeDisabled();
  });

  it("升级：编辑末节点资产管理员时审批人类型/角色锁定，但节点名称可编辑", async () => {
    const user = userEvent.setup();
    (workflowActions.getWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: detail2,
    });
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    await user.click(screen.getByText("升级配件流程 v2"));
    await screen.findByText("部门主管审批");

    await user.click(screen.getAllByTitle("编辑节点")[1]);
    // 审批人类型/角色以固定文案呈现，而非可选择下拉
    expect(screen.getByText(/按角色 · 资产管理员（末节点固定）/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /部门主管/ })).toBeNull();
    // 名称仍可编辑
    const nameInput = screen.getByLabelText("节点名称");
    await user.clear(nameInput);
    await user.type(nameInput, "最终资产管理员");
    expect(screen.getByDisplayValue("最终资产管理员")).toBeInTheDocument();
  });

  it("复制节点：调用 duplicateWorkflowNode", async () => {
    const user = userEvent.setup();
    (workflowActions.getWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: detail2,
    });
    (workflowActions.duplicateWorkflowNode as any).mockResolvedValue({
      success: true,
      data: { id: 30 },
    });
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    await user.click(screen.getByText("升级配件流程 v2"));
    await screen.findByText("部门主管审批");

    await user.click(screen.getAllByTitle("复制节点")[0]);

    await waitFor(() => {
      expect(workflowActions.duplicateWorkflowNode).toHaveBeenCalledWith(21);
    });
  });

  it("发布草稿版本：调用 publishWorkflowDefinition 并刷新列表", async () => {
    const user = userEvent.setup();
    (workflowActions.publishWorkflowDefinition as any).mockResolvedValue({
      success: true,
      data: { id: 2, version: 2 },
    });
    (workflowActions.getWorkflowDefinitions as any).mockResolvedValue({
      success: true,
      data: definitions,
    });
    render(<WorkflowsClient initialDefinitions={definitions as never} />);

    await user.click(screen.getAllByTitle("发布")[0]);

    await waitFor(() => {
      expect(workflowActions.publishWorkflowDefinition).toHaveBeenCalledWith(2);
    });
    expect(workflowActions.getWorkflowDefinitions).toHaveBeenCalled();
  });
});
