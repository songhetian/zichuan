"use server";

import { ActionResult } from "@/lib/types";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generateAssetNo } from "@/lib/asset-numbering";
import { computeAssetCapacities } from "@/lib/asset-capacity";
import { requireAuth } from "@/lib/auth";
import { guardPermission, resolveAssetScope } from "@/lib/permissions";
import { consumeBomStock, INSUFFICIENT_STOCK_PREFIX } from "@/lib/bom-stock";

// ============================================================
// Schema 校验
// ============================================================

// 模板必选：模板的 BOM 决定每台设备消耗哪些配件（用于扣减配件库存），也决定编号前缀。
// 无 BOM 的外设（显示器/打印机/交换机）用一个空配件清单的模板即可。
// 设备名称由系统维护，不接受人工输入：不填使用人即入闲置池（名称取模板名），填了则直接改为「{使用人}的{设备分类}」。
const createSchema = z.object({
  templateId: z.number({ required_error: "请选择设备模板" }),
  quantity: z.number().int().min(1, "数量至少为 1").optional(),
  // 使用人：填了即建档即分配（状态「在用」），不填则直接进闲置池（状态「闲置」）等待后续分配
  employeeId: z.number().int().positive().optional(),
  serialNo: z.string().optional(),
  location: z.string().optional(),
  purchaseDate: z.string().optional(),
  warrantyMonths: z.number().int().optional(),
  notes: z.string().optional(),
  operator: z.string().min(1, "操作员不能为空"),
});

const updateSchema = z.object({
  name: z.string().min(1, "设备名称不能为空").optional(),
  brand: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  serialNo: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  purchaseDate: z.string().optional().nullable(),
  warrantyMonths: z.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const querySchema = z.object({
  status: z.enum(["IDLE", "IN_USE", "IN_MAINTENANCE", "SCRAPPED"]).optional(),
  categoryId: z.number().optional(),
  employeeId: z.number().optional(),
  keyword: z.string().optional(),
  memoryMinGB: z.number().optional(),
  diskMinGB: z.number().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

type AssetDetail = {
  id: number;
  assetNo: string;
  name: string;
  templateId: number;
  templateName: string;
  categoryId: number;
  categoryName: string;
  status: string;
  employeeId: number | null;
  employeeName: string | null;
  departmentName: string | null;
  brand: string | null;
  model: string | null;
  serialNo: string | null;
  location: string | null;
  purchaseDate: Date | null;
  warrantyMonths: number | null;
  notes: string | null;
  createdAt: Date;
  components: {
    id: number;
    modelId: number;
    modelName: string;
    modelBrand: string | null;
    categoryName: string;
    quantity: number;
  }[];
  lifecycleLogs: {
    id: number;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    operator: string;
    remark: string | null;
    createdAt: Date;
  }[];
};

type PrismaAsset = {
  id: number;
  assetNo: string;
  name: string;
  templateId: number;
  template: {
    name: string;
    categoryId: number;
    category: { name: string } | null;
    components?: {
      model: { name: string; brand: string | null; category: { name: string } | null } | null;
      quantity: number;
    }[];
  } | null;
  status: string;
  employeeId: number | null;
  employee?: { name: string; department?: { name: string } | null } | null;
  brand: string | null;
  model: string | null;
  serialNo: string | null;
  location: string | null;
  purchaseDate: Date | null;
  warrantyMonths: number | null;
  notes: string | null;
  createdAt: Date;
  components: {
    id: number;
    modelId: number;
    model: { name: string; brand: string | null; category: { name: string } | null } | null;
    quantity: number;
  }[];
  lifecycleLogs?: {
    id: number;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    operator: string;
    remark: string | null;
    createdAt: Date;
  }[];
};

function formatAsset(asset: PrismaAsset | null): AssetDetail {
  if (!asset) {
    return {
      id: 0,
      assetNo: "",
      name: "",
      templateId: 0,
      templateName: "",
      categoryId: 0,
      categoryName: "",
      status: "",
      employeeId: null,
      employeeName: null,
      departmentName: null,
      brand: null,
      model: null,
      serialNo: null,
      location: null,
      purchaseDate: null,
      warrantyMonths: null,
      notes: null,
      createdAt: new Date(),
      components: [],
      lifecycleLogs: [],
    };
  }
  return {
    id: asset.id,
    assetNo: asset.assetNo,
    name: asset.name,
    templateId: asset.templateId,
    templateName: asset.template?.name ?? "",
    categoryId: asset.template?.categoryId ?? 0,
    categoryName: asset.template?.category?.name ?? "",
    status: asset.status,
    employeeId: asset.employeeId,
    employeeName: asset.employee?.name ?? null,
    departmentName: asset.employee?.department?.name ?? null,
    brand: asset.brand ?? null,
    model: asset.model ?? null,
    serialNo: asset.serialNo ?? null,
    location: asset.location ?? null,
    purchaseDate: asset.purchaseDate ?? null,
    warrantyMonths: asset.warrantyMonths ?? null,
    notes: asset.notes ?? null,
    createdAt: asset.createdAt,
    components: asset.components.map((c) => ({
      id: c.id,
      modelId: c.modelId,
      modelName: c.model?.name ?? "",
      modelBrand: c.model?.brand ?? null,
      categoryName: c.model?.category?.name ?? "",
      quantity: c.quantity,
    })),
    lifecycleLogs: (asset.lifecycleLogs ?? []).map((l) => ({
      id: l.id,
      action: l.action,
      fromStatus: l.fromStatus,
      toStatus: l.toStatus,
      operator: l.operator,
      remark: l.remark,
      createdAt: l.createdAt,
    })),
  };
}

// ============================================================
// Actions
// ============================================================

/**
 * 按模板批量建档。
 *
 * - 模板必选：模板的 BOM 决定每台设备消耗哪些配件，也决定编号前缀。
 * - quantity 决定一次生成几台，编号在事务内连续递增。
 * - 配件库存按「每台用量 × 数量」原子扣减并写 ASSET_BUILD（组装设备出库）流水；
 *   不足则整单拒绝 —— 不产生半台设备、不扣任何库存，提示按模板口径给出「最多可建几台」。
 * - 设备名称由系统维护：不填使用人即入闲置池（状态「闲置」，名称取模板名）；填了则建档即分配，名称与状态一步到位。
 */
export async function createAsset(
  input: z.infer<typeof createSchema>
): Promise<ActionResult<AssetDetail[]>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有资产管理权限");
  if (denied) return denied;

  const validated = createSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const {
    templateId,
    quantity = 1,
    employeeId,
    serialNo,
    location,
    purchaseDate,
    warrantyMonths,
    notes,
    operator,
  } = validated.data;

  const template = await prisma.deviceTemplate.findUnique({
    where: { id: templateId },
    include: { category: true, components: { include: { model: true } } },
  });
  if (!template) {
    return { success: false, error: "设备模板不存在" };
  }

  // 使用人：填了即建档即分配，没填则直接进可分配池（闲置）
  let assignee: { id: number; name: string } | null = null;
  if (employeeId != null) {
    assignee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true },
    });
    if (!assignee) {
      return { success: false, error: "使用人不存在" };
    }
  }
  const assetName = assignee ? `${assignee.name}的${template.category.name}` : template.name;
  const assetStatus = assignee ? "IN_USE" : "IDLE";

  try {
    const assetIds = await prisma.$transaction(async (tx) => {
      // 0) R4 唯一性校验：唯一分类设备同一员工至多持有 1 台（新建即分配 / 批量建档同样适用）
      if (assignee && template.category.unique) {
        const held = await tx.asset.count({
          where: {
            employeeId: assignee.id,
            template: { categoryId: template.categoryId },
            status: { in: ["IDLE", "IN_USE", "IN_MAINTENANCE"] },
          },
        });
        if (quantity > 1 || held > 0) {
          throw new Error(`UNIQUE_VIOLATION:${template.category.name}`);
        }
      }

      // 1) 按模板 BOM 出库配件（库存不足则整单拒绝）
      await consumeBomStock(tx, template, quantity, operator);

      // 2) 逐台建档
      const ids: number[] = [];
      for (let i = 0; i < quantity; i++) {
        const assetNo = await generateAssetNo(
          tx,
          template.category.code,
          template.category.numberingRule
        );

        const asset = await tx.asset.create({
          data: {
            assetNo,
            name: assetName,
            templateId,
            status: assetStatus,
            employeeId: assignee?.id ?? null,
            // 品牌/型号挂在模板上，建档统一带出，避免同类设备逐台重复登记
            brand: template.brand,
            model: template.model,
            // 数量>1 为批量建档，序列号对每台唯一无意义：忽略入参统一置空（与前端禁用一致）
            serialNo: quantity > 1 ? null : (serialNo ?? null),
            location: location ?? null,
            purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
            warrantyMonths: warrantyMonths ?? null,
            notes: notes ?? null,
          },
        });

        // 复制模板 BOM 配件到设备
        if (template.components.length > 0) {
          await tx.assetComponent.createMany({
            data: template.components.map((bom) => ({
              assetId: asset.id,
              modelId: bom.modelId,
              quantity: bom.quantity,
            })),
          });
        }

        // 记录生命周期日志
        await tx.lifecycleLog.create({
          data: {
            assetId: asset.id,
            action: assignee ? "ALLOCATED" : "CREATED",
            fromStatus: assignee ? "IDLE" : null,
            toStatus: assetStatus,
            employeeId: assignee?.id ?? null,
            operator,
            remark: assignee
              ? `按模板 ${template.name} 建档并分配给 ${assignee.name}`
              : `按模板 ${template.name} 生成并闲置`,
          },
        });

        ids.push(asset.id);
      }

      return ids;
    });

    // 查询完整信息返回
    const assets = (await prisma.asset.findMany({
      where: { id: { in: assetIds } },
      orderBy: { id: "asc" },
      include: {
        template: { select: { name: true, categoryId: true, category: { select: { name: true } } } },
        employee: { select: { name: true } },
        components: {
          include: { model: { select: { name: true, brand: true, category: { select: { name: true } } } } },
        },
        lifecycleLogs: { orderBy: { createdAt: "desc" } },
      },
    })) as unknown as PrismaAsset[];

    return { success: true, data: assets.map(formatAsset) };
  } catch (e) {
    if (e instanceof Error) {
      if (e.message.startsWith(INSUFFICIENT_STOCK_PREFIX)) {
        return { success: false, error: e.message.slice(INSUFFICIENT_STOCK_PREFIX.length) };
      }
      if (e.message.startsWith("UNIQUE_VIOLATION")) {
        const categoryNames = e.message.split(":")[1] ?? "";
        return {
          success: false,
          error: `唯一性约束：员工已拥有该分类（${categoryNames}）下的设备，不能重复建档分配`,
        };
      }
      if (e.message.includes("Unique constraint")) {
        return { success: false, error: "设备编号已存在，请重试" };
      }
      if (e.message.includes("Foreign key constraint")) {
        return { success: false, error: "关联数据不存在，无法创建设备" };
      }
      return { success: false, error: `创建设备失败：${e.message}` };
    }
    return { success: false, error: "创建设备失败，请稍后重试" };
  }
}

/**
 * 解析当前账号的资产数据范围（读操作越权防护）：
 * - asset.manage（超管/资产管理员）：
 *     无显式部门范围（'ALL'）→ 全部资产；角色限定部门（'SPEC'）→ 仅这些部门员工持有的设备
 * - 否则 dept.data.view 的部门主管/超管 → 仅本部门资产
 * - 否则→ 仅本人名下（asset.view.own），无员工身份则不可见
 */
export async function getAssets(
  input: z.infer<typeof querySchema> = {}
): Promise<ActionResult<AssetDetail[]>> {
  const user = await requireAuth();

  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const { status, categoryId, employeeId, keyword, memoryMinGB, diskMinGB, page, pageSize } = validated.data;

  const where: Prisma.AssetWhereInput = {};
  if (status) where.status = status;
  if (employeeId != null) where.employeeId = employeeId;
  if (categoryId != null) {
    where.template = { categoryId };
  }
  if (keyword) {
    where.OR = [
      { assetNo: { contains: keyword } },
      { name: { contains: keyword } },
      { brand: { contains: keyword } },
      { model: { contains: keyword } },
      { serialNo: { contains: keyword } },
    ];
  }
  // 数据范围过滤（越权防护）：asset.manage 全部；否则本部门数据可见 → 本部门；再否则仅本人名下
  const scope = await resolveAssetScope(user.id);
  if (scope) Object.assign(where, scope);

  try {
    const queryOptions: any = {
      where,
      orderBy: { createdAt: "desc" as const },
      include: {
        template: {
          select: {
            name: true,
            categoryId: true,
            category: { select: { name: true } },
            components: {
              include: {
                model: {
                  select: {
                    name: true,
                    brand: true,
                    category: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
        employee: { select: { name: true } },
        components: {
          include: { model: { select: { name: true, brand: true, category: { select: { name: true } } } } },
        },
      },
    };

    // 分页支持
    if (page != null && pageSize != null) {
      queryOptions.skip = (page - 1) * pageSize;
      queryOptions.take = pageSize;
    }

    const assets = await prisma.asset.findMany(queryOptions) as unknown as PrismaAsset[];

    // 预展开模板 BOM 组件（用于容量筛选，设备本身不写配件记录）
    const formatted = assets.map((asset) => ({
      ...formatAsset(asset),
      _templateComponents: (asset.template?.components ?? []).map((tc) => ({
        modelName: tc.model?.name ?? "",
        quantity: tc.quantity,
      })),
    }));

    // 服务端容量筛选（基于模板 BOM 的配置，而非设备的配件记录）
    let filtered = formatted;
    if (memoryMinGB != null) {
      filtered = filtered.filter((asset) => {
        const caps = computeAssetCapacities((asset as any)._templateComponents ?? []);
        return caps.memoryGB >= memoryMinGB;
      });
    }
    if (diskMinGB != null) {
      filtered = filtered.filter((asset) => {
        const caps = computeAssetCapacities((asset as any)._templateComponents ?? []);
        return caps.diskGB >= diskMinGB;
      });
    }

    return { success: true, data: filtered };
  } catch (e) {
    return { success: false, error: "查询设备列表失败，请稍后重试" };
  }
}

export async function getAssetById(
  id: number
): Promise<ActionResult<AssetDetail>> {
  const user = await requireAuth();
  const scope = await resolveAssetScope(user.id);

  try {
    const where: Prisma.AssetWhereInput = { id };
    if (scope) Object.assign(where, scope);
    const asset = await prisma.asset.findFirst({
      where,
      include: {
        template: {
          select: {
            name: true,
            categoryId: true,
            category: { select: { name: true } },
          },
        },
        employee: { select: { name: true, department: { select: { name: true } } } },
        components: {
          include: { model: { select: { name: true, brand: true, category: { select: { name: true } } } } },
        },
        lifecycleLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!asset) {
      return { success: false, error: "设备不存在" };
    }

    return { success: true, data: formatAsset(asset) };
  } catch (e) {
    return { success: false, error: "查询设备详情失败，请稍后重试" };
  }
}

export async function updateAsset(
  id: number,
  input: z.infer<typeof updateSchema>
): Promise<ActionResult<AssetDetail>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有资产管理权限");
  if (denied) return denied;

  const validated = updateSchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: validated.error.errors[0]?.message ?? "参数错误" };
  }

  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "设备不存在" };
  }

  const updateData: Record<string, unknown> = {};
  if (validated.data.name != null) updateData.name = validated.data.name;
  if (validated.data.brand !== undefined) updateData.brand = validated.data.brand;
  if (validated.data.model !== undefined) updateData.model = validated.data.model;
  if (validated.data.serialNo !== undefined) updateData.serialNo = validated.data.serialNo;
  if (validated.data.location !== undefined) updateData.location = validated.data.location;
  if (validated.data.purchaseDate !== undefined) {
    updateData.purchaseDate = validated.data.purchaseDate ? new Date(validated.data.purchaseDate) : null;
  }
  if (validated.data.warrantyMonths !== undefined) {
    updateData.warrantyMonths = validated.data.warrantyMonths;
  }
  if (validated.data.notes !== undefined) updateData.notes = validated.data.notes;

  try {
    const asset = await prisma.asset.update({
      where: { id },
      data: updateData,
      include: {
        template: {
          select: {
            name: true,
            categoryId: true,
            category: { select: { name: true } },
          },
        },
        employee: { select: { name: true } },
        components: {
          include: { model: { select: { name: true, brand: true, category: { select: { name: true } } } } },
        },
        lifecycleLogs: { orderBy: { createdAt: "desc" } },
      },
    });

    return { success: true, data: formatAsset(asset) };
  } catch (e) {
    if (e instanceof Error) {
      if (e.message.includes("Record to update not found")) {
        return { success: false, error: "设备不存在或已被删除" };
      }
      return { success: false, error: `更新设备失败：${e.message}` };
    }
    return { success: false, error: "更新设备失败，请稍后重试" };
  }
}

export async function deleteAsset(
  id: number
): Promise<ActionResult<{ id: number }>> {
  const user = await requireAuth();
  const denied = await guardPermission(user, "asset.manage", "没有资产管理权限");
  if (denied) return denied;

  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) {
    return { success: false, error: "设备不存在" };
  }
  // 在途申请已预占该设备：删除会让审批执行时找不到设备（孤儿单），直接拒绝
  if (existing.reservedByRequestId != null) {
    return { success: false, error: "该设备存在在途申请（已预占），无法删除" };
  }

  try {
    await prisma.asset.delete({ where: { id } });
    return { success: true, data: { id } };
  } catch (e) {
    if (e instanceof Error && e.message.includes("Foreign key constraint")) {
      return { success: false, error: "该设备有关联数据，无法删除" };
    }
    return { success: false, error: "删除设备失败，请稍后重试" };
  }
}
