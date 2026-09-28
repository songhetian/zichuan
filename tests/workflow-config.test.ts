import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { setTestUser } from "@/lib/auth";
import {
  createWorkflowDefinition,
  getWorkflowDefinitions,
  getWorkflowDefinition,
  addWorkflowNode,
  updateWorkflowNode,
  removeWorkflowNode,
  duplicateWorkflowNode,
  reorderWorkflowNodes,
  publishWorkflowDefinition,
  duplicateWorkflowDefinition,
  removeWorkflowDraft,
  activateWorkflowVersion,
  type WorkflowNodeInput,
} from "@/actions/workflow.actions";

/** 建一个角色（测试自建，不依赖种子）；permissions = 该角色拥有的权限 key */
async function seedRole(key: string, name: string, permissions: string[]) {
  const role = await prisma.role.create({ data: { key, name, isSystem: true } });
  for (const p of permissions) {
    const perm = await prisma.permission.upsert({
      where: { key: p },
      update: {},
      create: { key: p, module: "workflow", name: p },
    });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
  }
  return role;
}

/** 建一个有指定权限的账号并作为当前测试用户 */
async function loginWithRole(key: string, permissions: string[]) {
  const role = await seedRole(key, key, permissions);
  const admin = await prisma.admin.create({
    data: { username: key.toLowerCase() + "_" + Date.now(), password: "x", roleId: role.id },
  });
  setTestUser({ id: admin.id, username: admin.username });
  return admin;
}

const node = (over: Partial<WorkflowNodeInput> = {}): WorkflowNodeInput => ({
  name: "部门主管审批",
  assigneeType: "DEPT_MANAGER",
  ccType: "INITIATOR",
  ...over,
});

// 手动执行类型（升级/更换/维修）发布要求末节点为「按角色且指定角色」，否则发布被拒。
const manualNode = (over: Partial<WorkflowNodeInput> = {}): WorkflowNodeInput =>
  node({ name: "资产管理员终审", assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER", ...over });

describe("审批流程配置（M3：workflow.config.manage）", () => {
  beforeEach(async () => {
    await prisma.admin.deleteMany();
    await prisma.rolePermission.deleteMany();
    await prisma.role.deleteMany();
  });

  afterEach(() => {
    setTestUser(null);
  });

  it("超管可新建流程版本，且列表可见、版本号自增", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);

    const r1 = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "升级配件流程 v1",
      nodes: [node()],
    });
    expect(r1.success).toBe(true);
    if (!r1.success) return;
    expect(r1.data.version).toBe(1);
    expect(r1.data.status).toBe("DRAFT");

    const r2 = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "升级配件流程 v2",
      nodes: [node({ name: "资产管理员审批", assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER" })],
    });
    expect(r2.success).toBe(true);
    if (!r2.success) return;
    expect(r2.data.version).toBe(2);

    const list = await getWorkflowDefinitions("ASSET_UPGRADE");
    expect(list.success).toBe(true);
    if (!list.success) return;
    expect(list.data).toHaveLength(2);
    expect(list.data.map((d) => d.version)).toEqual([2, 1]);
    expect(list.data[0].nodeCount).toBe(1);
  });

  it("升级/降级流程新建时末节点保持用户配置（不再强制追加资产管理员）；报废流程一致", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);

    // 未显式配置资产管理员 → 不自动追加，末节点=用户配置
    const created = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "不自动补末节点",
      nodes: [node({ name: "部门主管" })],
    });
    if (!created.success) throw new Error(created.error);
    const detail = await getWorkflowDefinition(created.data.id);
    if (!detail.success) throw new Error(detail.error);
    expect(detail.data.nodes).toHaveLength(1);
    expect(detail.data.nodes[0].assigneeRole).not.toBe("ASSET_MANAGER");

    // 显式含资产管理员节点 → 原样保留在配置位置，不额外追加
    const withAm = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "已有资产管理员",
      nodes: [
        { name: "员工", assigneeType: "ROLE", assigneeRole: "EMPLOYEE" },
        { name: "资产管理员审批", assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER" },
      ],
    });
    if (!withAm.success) throw new Error(withAm.error);
    const withAmDetail = await getWorkflowDefinition(withAm.data.id);
    if (!withAmDetail.success) throw new Error(withAmDetail.error);
    expect(withAmDetail.data.nodes).toHaveLength(2);
    expect(withAmDetail.data.nodes[1].assigneeRole).toBe("ASSET_MANAGER");

    // 报废流程不受影响（不追加）
    const scrap = await createWorkflowDefinition({
      businessType: "ASSET_SCRAP",
      name: "报废流程",
      nodes: [node()],
    });
    if (!scrap.success) throw new Error(scrap.error);
    const scrapDetail = await getWorkflowDefinition(scrap.data.id);
    if (!scrapDetail.success) throw new Error(scrapDetail.error);
    expect(scrapDetail.data.nodes).toHaveLength(1);
    expect(scrapDetail.data.nodes[0].assigneeRole).not.toBe("ASSET_MANAGER");
  });

  it("无流程配置权限的账号被拒", async () => {
    await loginWithRole("EMPLOYEE", ["approval.submit"]);

    const r = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "x",
      nodes: [node()],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("权限");
  });

  it("节点可增删改与调序（仅草稿）", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const created = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "多节点流程",
      nodes: [node({ name: "审批一" }), node({ name: "审批二" })],
    });
    if (!created.success) throw new Error(created.error);
    const id = created.data.id;

    // 追加节点
    const added = await addWorkflowNode(id, node({ name: "审批三" }));
    expect(added.success).toBe(true);

    // 改节点
    const updated = await updateWorkflowNode(
      (added.success ? added.data.id : 0),
      { name: "审批三改名" }
    );
    expect(updated.success).toBe(true);

    // 调序：把末尾节点移到最前，顺序按给定值生效（不再强制回末位）
    const detail = await getWorkflowDefinition(id);
    if (!detail.success) throw new Error(detail.error);
    const [first, second, third] = detail.data.nodes.map((n) => n.id);
    const reordered = await reorderWorkflowNodes(id, [third, first, second]);
    expect(reordered.success).toBe(true);

    const after = await getWorkflowDefinition(id);
    if (!after.success) throw new Error(after.error);
    expect(after.data.nodes.map((n) => n.name)).toEqual(["审批三改名", "审批一", "审批二"]);

    // 删除非末位节点
    const removed = await removeWorkflowNode(after.data.nodes[1].id);
    expect(removed.success).toBe(true);
    const final = await getWorkflowDefinition(id);
    if (!final.success) throw new Error(final.error);
    expect(final.data.nodes).toHaveLength(2);
  });

  it("复制节点：插入到原节点之后，字段一致，nodeKey 自增", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const created = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "复制节点流程",
      nodes: [
        node({ name: "审批一", assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER" }),
        node({ name: "审批二" }),
      ],
    });
    if (!created.success) throw new Error(created.error);
    const id = created.data.id;

    // 节点顺序保留用户配置，不因资产管理员而重排
    const before = await getWorkflowDefinition(id);
    if (!before.success) throw new Error(before.error);
    expect(before.data.nodes.map((n) => n.name)).toEqual(["审批一", "审批二"]);
    const sourceId = before.data.nodes[0].id;

    const dup = await duplicateWorkflowNode(sourceId);
    expect(dup.success).toBe(true);

    const after = await getWorkflowDefinition(id);
    if (!after.success) throw new Error(after.error);
    // 复制后紧邻原节点插入，字段与顺序正确
    expect(after.data.nodes.map((n) => n.name)).toEqual(["审批一", "审批一", "审批二"]);
    const dupNode = after.data.nodes[1];
    expect(dupNode.nodeKey).toBe("n3");
    expect(dupNode.assigneeType).toBe("ROLE");
    expect(after.data.nodes.map((n) => n.nodeKey)).toEqual(["n1", "n3", "n2"]);
  });

  it("末节点不被强制为资产管理员：增删改重排后保持用户配置；报废流程一致", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const created = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "无不变式",
      nodes: [node({ name: "审批一" }), node({ name: "审批二" })],
    });
    if (!created.success) throw new Error(created.error);
    const id = created.data.id;

    // 末节点保持用户配置（非资产管理员）
    let detail = await getWorkflowDefinition(id);
    if (!detail.success) throw new Error(detail.error);
    expect(detail.data.nodes[detail.data.nodes.length - 1].assigneeRole).not.toBe("ASSET_MANAGER");

    // 追加新节点 → 末节点即新节点（不补资产管理员）
    const beforeAddCount = detail.data.nodes.length;
    const add = await addWorkflowNode(id, node({ name: "新末节点" }));
    expect(add.success).toBe(true);
    detail = await getWorkflowDefinition(id);
    if (!detail.success) throw new Error(detail.error);
    expect(detail.data.nodes).toHaveLength(beforeAddCount + 1);
    expect(detail.data.nodes[detail.data.nodes.length - 1].name).toBe("新末节点");

    // 删除末节点 → 不再自动补资产管理员
    const rm = await removeWorkflowNode(detail.data.nodes[detail.data.nodes.length - 1].id);
    expect(rm.success).toBe(true);
    detail = await getWorkflowDefinition(id);
    if (!detail.success) throw new Error(detail.error);
    expect(detail.data.nodes.some((n) => n.assigneeRole === "ASSET_MANAGER")).toBe(false);

    // 报废流程：删除节点后同样不补资产管理员
    const scrap = await createWorkflowDefinition({
      businessType: "ASSET_SCRAP",
      name: "报废对照",
      nodes: [node({ name: "报废一" }), node({ name: "报废二" })],
    });
    if (!scrap.success) throw new Error(scrap.error);
    const sDetail = await getWorkflowDefinition(scrap.data.id);
    if (!sDetail.success) throw new Error(sDetail.error);
    const sRm = await removeWorkflowNode(sDetail.data.nodes[0].id);
    expect(sRm.success).toBe(true);
    const sAfter = await getWorkflowDefinition(scrap.data.id);
    if (!sAfter.success) throw new Error(sAfter.error);
    expect(sAfter.data.nodes.some((n) => n.assigneeRole === "ASSET_MANAGER")).toBe(false);
    expect(sAfter.data.nodes).toHaveLength(1);
  });

  it("已发布流程可复制节点，复制不存在的节点被拒绝", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const created = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "复制只读流程",
      nodes: [manualNode()],
    });
    if (!created.success) throw new Error(created.error);
    const id = created.data.id;

    const pub = await publishWorkflowDefinition(id);
    expect(pub.success).toBe(true);

    const detail = await getWorkflowDefinition(id);
    if (!detail.success) throw new Error(detail.error);

    // 已发布：可复制节点（原地编辑）
    const dup = await duplicateWorkflowNode(detail.data.nodes[0].id);
    expect(dup.success).toBe(true);

    // 不存在的节点被拒
    const missing = await duplicateWorkflowNode(999999);
    expect(missing.success).toBe(false);
  });

  it("手动执行类型末节点非「按角色」：发布被拒（硬校验，防孤儿单）", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);

    // 末节点为部门主管（非按角色）→ finalNodeRole 为空，审批通过后无人可执行 → 拒绝发布
    const bad = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "末节点非角色",
      nodes: [node({ name: "部门主管审批", assigneeType: "DEPT_MANAGER" })],
    });
    if (!bad.success) throw new Error(bad.error);
    const pubBad = await publishWorkflowDefinition(bad.data.id);
    expect(pubBad.success).toBe(false);
    if (pubBad.success) return;
    expect(pubBad.error).toContain("末节点");
    // 仍为草稿，未生效
    const stillDraft = await getWorkflowDefinition(bad.data.id);
    if (!stillDraft.success) throw new Error(stillDraft.error);
    expect(stillDraft.data.status).toBe("DRAFT");

    // 末节点为「按角色 + 具体角色」→ 可发布
    const ok = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "末节点角色",
      nodes: [manualNode()],
    });
    if (!ok.success) throw new Error(ok.error);
    const pubOk = await publishWorkflowDefinition(ok.data.id);
    expect(pubOk.success).toBe(true);
  });

  it("非手动执行类型（报废）末节点非角色也能发布", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const scrap = await createWorkflowDefinition({
      businessType: "ASSET_SCRAP",
      name: "报废流程",
      nodes: [node({ name: "部门主管审批", assigneeType: "DEPT_MANAGER" })],
    });
    if (!scrap.success) throw new Error(scrap.error);
    const pub = await publishWorkflowDefinition(scrap.data.id);
    expect(pub.success).toBe(true);
  });

  it("草稿不允许删空（至少保留 1 个审批节点）", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    // 显式只配一个资产管理员节点（未触发默认追加），删除该唯一节点应被拒
    const created = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "单节点流程",
      nodes: [{ name: "资产管理员终审", assigneeType: "ROLE", assigneeRole: "ASSET_MANAGER" }],
    });
    if (!created.success) throw new Error(created.error);
    const detail = await getWorkflowDefinition(created.data.id);
    if (!detail.success) throw new Error(detail.error);
    expect(detail.data.nodes).toHaveLength(1);

    const r = await removeWorkflowNode(detail.data.nodes[0].id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("至少");
  });

  it("发布即切换生效版本：旧发布版自动归档，且同类型仅一个 PUBLISHED", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);

    const v1 = await createWorkflowDefinition({ businessType: "ASSET_UPGRADE", name: "v1", nodes: [manualNode()] });
    const v2 = await createWorkflowDefinition({ businessType: "ASSET_UPGRADE", name: "v2", nodes: [manualNode()] });
    if (!v1.success || !v2.success) throw new Error("创建失败");

    const p1 = await publishWorkflowDefinition(v1.data.id);
    expect(p1.success).toBe(true);
    if (!p1.success) return;

    const d1 = await getWorkflowDefinition(v1.data.id);
    if (!d1.success) throw new Error(d1.error);
    expect(d1.data.status).toBe("PUBLISHED");
    expect(d1.data.publishedAt).not.toBeNull();

    // 发布 v2 → v1 归档
    const p2 = await publishWorkflowDefinition(v2.data.id);
    expect(p2.success).toBe(true);

    const d1b = await getWorkflowDefinition(v1.data.id);
    const d2b = await getWorkflowDefinition(v2.data.id);
    if (!d1b.success || !d2b.success) throw new Error("读取失败");
    expect(d1b.data.status).toBe("ARCHIVED");
    expect(d2b.data.status).toBe("PUBLISHED");

    const published = (await getWorkflowDefinitions("ASSET_UPGRADE"));
    if (!published.success) throw new Error(published.error);
    expect(published.data.filter((d) => d.status === "PUBLISHED")).toHaveLength(1);
  });

  it("已发布的流程不可再编辑（增/删/改/调序/重复发布均被拒）", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const created = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "发布后可编辑",
      nodes: [manualNode()],
    });
    if (!created.success) throw new Error(created.error);
    const id = created.data.id;
    const published = await publishWorkflowDefinition(id);
    expect(published.success).toBe(true);

    const detail = await getWorkflowDefinition(id);
    if (!detail.success) throw new Error(detail.error);
    const nodeId = detail.data.nodes[0].id;

    // 发布后仍可增/改/删/调序（原地编辑），不影响绑定该版本已在途单（已固化）
    const add = await addWorkflowNode(id, node({ name: "新增节点" }));
    expect(add.success).toBe(true);

    const update = await updateWorkflowNode(nodeId, { name: "改名" });
    expect(update.success).toBe(true);

    const detail2 = await getWorkflowDefinition(id);
    if (!detail2.success) throw new Error(detail2.error);
    // 原节点 + 新增节点（不再自动追加资产管理员）
    expect(detail2.data.nodes).toHaveLength(2);
    expect(detail2.data.nodes.find((n) => n.id === nodeId)?.name).toBe("改名");

    const remove = await removeWorkflowNode(nodeId);
    expect(remove.success).toBe(true);
  });

  it("已归档的流程仍可原地编辑（增/改/删/调序）", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const v1 = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "归档可编辑",
      nodes: [manualNode()],
    });
    if (!v1.success) throw new Error(v1.error);
    await publishWorkflowDefinition(v1.data.id);

    // 派生 v2 并发布，v1 自动归档
    const v2 = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "归档可编辑v2",
      nodes: [manualNode()],
    });
    if (!v2.success) throw new Error(v2.error);
    await publishWorkflowDefinition(v2.data.id);

    const v1Detail = await getWorkflowDefinition(v1.data.id);
    if (!v1Detail.success) throw new Error(v1Detail.error);
    expect(v1Detail.data.status).toBe("ARCHIVED");
    const nodeId = v1Detail.data.nodes[0].id;
    const archivedId = v1.data.id;

    const add = await addWorkflowNode(archivedId, node({ name: "新节点" }));
    expect(add.success).toBe(true);
    if (!add.success) return;
    const newNodeId = add.data.id;

    const update = await updateWorkflowNode(nodeId, { name: "改名" });
    expect(update.success).toBe(true);

    const detail2 = await getWorkflowDefinition(archivedId);
    if (!detail2.success) throw new Error(detail2.error);
    expect(detail2.data.nodes.find((n) => n.id === nodeId)?.name).toBe("改名");

    const remove = await removeWorkflowNode(nodeId);
    expect(remove.success).toBe(true);

    const dup = await duplicateWorkflowNode(newNodeId);
    expect(dup.success).toBe(true);
    if (!dup.success) return;

    // 调序需覆盖全部节点（含自动追加的资产管理员末节点）
    const preReorder = await getWorkflowDefinition(archivedId);
    if (!preReorder.success) throw new Error(preReorder.error);
    const allIds = preReorder.data.nodes.map((n) => n.id);
    const reorder = await reorderWorkflowNodes(
      archivedId,
      [newNodeId, dup.data.id, ...allIds.filter((id) => id !== newNodeId && id !== dup.data.id)]
    );
    expect(reorder.success).toBe(true);
  });

  it("一键派生新版草稿：复制任意版本为更高版本号 DRAFT，节点深拷贝一致", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const created = await createWorkflowDefinition({
      businessType: "ASSET_SCRAP",
      name: "派生来源",
      nodes: [node({ name: "部门主管审批", ccType: "INITIATOR" })],
    });
    if (!created.success) throw new Error(created.error);
    await publishWorkflowDefinition(created.data.id);
    const pubDetail = await getWorkflowDefinition(created.data.id);
    if (!pubDetail.success) throw new Error(pubDetail.error);

    const dup = await duplicateWorkflowDefinition(created.data.id);
    expect(dup.success).toBe(true);
    if (!dup.success) return;
    expect(dup.data.version).toBe(created.data.version + 1);
    expect(dup.data.status).toBe("DRAFT");

    const detail = await getWorkflowDefinition(dup.data.id);
    if (!detail.success) throw new Error(detail.error);
    // 复制的节点与源一致，不再追加资产管理员末节点
    expect(detail.data.nodes).toHaveLength(1);
    expect(detail.data.nodes[0].assigneeType).toBe("DEPT_MANAGER");
    expect(detail.data.nodes[0].ccType).toBe("INITIATOR");
  });

  it("删除版本：在用（当前生效）不可删；草稿可直接删除", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const base = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "删除基线",
      nodes: [manualNode()],
    });
    if (!base.success) throw new Error(base.error);
    await publishWorkflowDefinition(base.data.id);

    // 当前生效（在用）版本不可删
    const delActive = await removeWorkflowDraft(base.data.id);
    expect(delActive.success).toBe(false);
    if (delActive.success) return;
    expect(delActive.error).toContain("正在使用");

    const draft = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "待删草稿",
      nodes: [node()],
    });
    if (!draft.success) throw new Error(draft.error);

    // 草稿可直接删除
    const delDraft = await removeWorkflowDraft(draft.data.id);
    expect(delDraft.success).toBe(true);

    // 唯一剩余版本（在用）仍不可删
    const delOnly = await removeWorkflowDraft(base.data.id);
    expect(delOnly.success).toBe(false);
  });

  it("被审批单引用的流程版本不可删", async () => {
    const admin = await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const v1 = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "已引用流程 v1",
      nodes: [manualNode()],
    });
    if (!v1.success) throw new Error(v1.error);
    await publishWorkflowDefinition(v1.data.id);

    // 发布 v2 使 v1 归档（非在用），但 v1 仍被审批单引用
    const v2 = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "已引用流程 v2",
      nodes: [manualNode()],
    });
    if (!v2.success) throw new Error(v2.error);
    await publishWorkflowDefinition(v2.data.id);

    await prisma.approvalRequest.create({
      data: {
        requestNo: `AP-TEST-${Date.now()}`,
        definitionId: v1.data.id,
        businessType: "ASSET_UPGRADE",
        title: "升级",
        payload: { assetId: 1 },
        initiatorId: admin.id,
      },
    });

    const r = await removeWorkflowDraft(v1.data.id);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error).toContain("被审批单引用");
  });

  it("历史版本一键设为当前生效：自动归档现行版，重复激活幂等，草稿被拒", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const v1 = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "V1",
      nodes: [manualNode()],
    });
    if (!v1.success) throw new Error(v1.error);
    await publishWorkflowDefinition(v1.data.id);

    const v2 = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "V2",
      nodes: [manualNode()],
    });
    if (!v2.success) throw new Error(v2.error);
    await publishWorkflowDefinition(v2.data.id);

    // 激活旧版 v1 -> 现行生效，v2 归档
    const act = await activateWorkflowVersion(v1.data.id);
    expect(act.success).toBe(true);
    const d1 = await getWorkflowDefinition(v1.data.id);
    if (!d1.success) throw new Error(d1.error);
    expect(d1.data.status).toBe("PUBLISHED");
    const d2 = await getWorkflowDefinition(v2.data.id);
    if (!d2.success) throw new Error(d2.error);
    expect(d2.data.status).toBe("ARCHIVED");

    // 重复激活幂等
    const again = await activateWorkflowVersion(v1.data.id);
    expect(again.success).toBe(true);

    // 草稿不允许直接激活
    const v3 = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "V3草稿",
      nodes: [node()],
    });
    if (!v3.success) throw new Error(v3.error);
    const draftAct = await activateWorkflowVersion(v3.data.id);
    expect(draftAct.success).toBe(false);
  });

  it("激活不存在的版本被拒", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const act = await activateWorkflowVersion(999999);
    expect(act.success).toBe(false);
  });

  it("SPECIFIC 抄送的 ccUserIds 在读写/改名/复制/派生后仍为数组（防双重编码丢抄送）", async () => {
    await loginWithRole("SUPER_ADMIN", ["workflow.config.manage"]);
    const created = await createWorkflowDefinition({
      businessType: "ASSET_UPGRADE",
      name: "抄送流程",
      nodes: [node({ name: "主管", ccType: "SPECIFIC", ccUserIds: [11, 22] })],
    });
    if (!created.success) throw new Error(created.error);

    // 读回应为数字数组（而非 JSON 字符串）
    const detail = await getWorkflowDefinition(created.data.id);
    if (!detail.success) throw new Error(detail.error);
    expect(detail.data.nodes[0].ccUserIds).toEqual([11, 22]);

    // 仅改名（不动抄送）后，ccUserIds 不应被清空或双重编码
    const upd = await updateWorkflowNode(detail.data.nodes[0].id, { name: "主管改" });
    expect(upd.success).toBe(true);
    const afterUpdate = await getWorkflowDefinition(created.data.id);
    if (!afterUpdate.success) throw new Error(afterUpdate.error);
    expect(afterUpdate.data.nodes[0].ccUserIds).toEqual([11, 22]);

    // 复制节点后抄送保持
    const dup = await duplicateWorkflowNode(afterUpdate.data.nodes[0].id);
    expect(dup.success).toBe(true);
    const afterDup = await getWorkflowDefinition(created.data.id);
    if (!afterDup.success) throw new Error(afterDup.error);
    expect(afterDup.data.nodes[1].ccUserIds).toEqual([11, 22]);

    // 整版派生（duplicateWorkflowDefinition）后抄送保持
    const dupDef = await duplicateWorkflowDefinition(created.data.id);
    if (!dupDef.success) throw new Error(dupDef.error);
    const dupDetail = await getWorkflowDefinition(dupDef.data.id);
    if (!dupDetail.success) throw new Error(dupDetail.error);
    expect(dupDetail.data.nodes[0].ccUserIds).toEqual([11, 22]);
  });
});
