import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateAssetNo } from "@/lib/asset-numbering";
import { generateEmployeeNo } from "@/lib/employee-no";
import { modelMatches } from "@/lib/device-check";
import bcrypt from "bcryptjs";

/**
 * 现场设备登记 API（tools/device-register exe 调用，无登录态）。
 *
 * 流程：输入部门 + 员工姓名（没有就创建）→ 把现场采集的主机/显示器
 * 直接建成设备台账（设备详情），不要求选模板（服务端自动用「现场直录」模板）。
 *
 * 安全口径：
 *  - 可选令牌闸门：设置 DEVICE_CHECK_TOKEN 后必须携带同值请求头 x-device-token；
 *  - 内部 LAN 使用；每次调用写 SystemLog（operator = 现场主机名）。
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 分类名 → 新建时的编号前缀（已存在的分类沿用其自身 code） */
const FALLBACK_CODES: Record<string, string> = {
  笔记本: "LP",
  台式机: "DN",
  显示器: "XS",
};
const DIRECT_TEMPLATE_NAME = "现场直录";
/** 「持有」状态口径，与 R4 唯一性校验一致 */
const HOLDING = ["IDLE", "IN_USE", "IN_MAINTENANCE"] as const;

interface RegisterItemResult {
  kind: "host" | "monitor";
  action:
    | "CREATED" // 新建
    | "EXISTS" // 已存在（去重）
    | "CONFLICT" // R4 唯一冲突
    | "WRITTEN" // 按已有编号写入配置成功
    | "NOT_FOUND" // 编号不存在
    | "IN_USE" // 编号已有人在用，拦截写入
    | "SKIPPED";
  assetNo: string | null;
  model: string | null;
  /** EXISTS 时对型号的一致性结论 */
  verdict: "MATCH" | "MISMATCH" | null;
  holder: string | null;
  message: string;
}

interface RegisterBody {
  hostname?: string;
  department?: string;
  employeeName?: string;
  hostAssetNo?: string; // 已有主机编号：填了就把配置写进该记录（不新建）
  host?: {
    model?: string;
    serial?: string;
    brand?: string;
    isLaptop?: boolean;
    notes?: string; // 无法归入配件的标识信息（MAC 等），写入备注
    parts?: RegisterPartInput[]; // 现场采集的硬件配置 → 写入配件配置（AssetComponent）
  };
  monitor?: {
    model?: string;
    serial?: string;
    brand?: string; // 显示器品牌（EDID 厂商码解析）
    notes?: string; // 显示器自己的配置说明
  } | null;
  monitorAssetNo?: string; // 已有显示器编号：同上
}

/** 找分类，没有就按 FALLBACK_CODES 建（code 冲突自动顺延） */
async function ensureCategory(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], name: string) {
  const found = await tx.assetCategory.findUnique({ where: { name } });
  if (found) return found;

  const base = FALLBACK_CODES[name] ?? name.slice(0, 2).toUpperCase();
  let code = base;
  for (let i = 2; i < 100; i++) {
    const taken = await tx.assetCategory.findUnique({ where: { code } });
    if (!taken) break;
    code = `${base}${i}`;
  }
  return tx.assetCategory.create({
    data: { name, code, unique: name !== "显示器" },
  });
}

interface RegisterPartInput {
  category?: string; // 配件分类名（主板/处理器/内存/硬盘/显卡/键盘/鼠标/操作系统）
  name?: string;
  brand?: string;
}

/** 找「现场直录」模板，没有就建（不含 BOM，纯载体满足 templateId 非空） */
async function ensureDirectTemplate(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  categoryId: number
) {
  const found = await tx.deviceTemplate.findFirst({ where: { categoryId, name: DIRECT_TEMPLATE_NAME } });
  if (found) return found;
  return tx.deviceTemplate.create({ data: { name: DIRECT_TEMPLATE_NAME, categoryId } });
}

/**
 * 把现场采集的硬件配置写入「配件配置」（AssetComponent）。
 * 配件分类/型号不存在就自动创建；整体替换该资产现有配件（重新登记 = 修正配置）。
 * 只对「现场直录」模板的资产生效——网页端按模板组装的设备，配件配置在模板 BOM 里，不动。
 */
async function syncAssetComponents(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  assetId: number,
  templateName: string | null,
  parts: RegisterPartInput[] | undefined
) {
  if (!parts?.length || templateName !== DIRECT_TEMPLATE_NAME) return;
  const cleaned = parts
    .map((p) => ({
      category: (p.category ?? "").trim().slice(0, 50),
      name: (p.name ?? "").trim().slice(0, 120),
      brand: (p.brand ?? "").trim().slice(0, 50),
    }))
    .filter((p) => p.category && p.name)
    .slice(0, 20);
  if (!cleaned.length) return;

  // 同规格聚合（如两根同型号内存），并保证 deleteMany 后 upsert 不撞 (assetId, modelId)
  const byKey = new Map<string, { category: string; name: string; brand: string; quantity: number }>();
  for (const p of cleaned) {
    const key = `${p.category}\u0000${p.name}\u0000${p.brand}`;
    const hit = byKey.get(key);
    if (hit) hit.quantity += 1;
    else byKey.set(key, { ...p, quantity: 1 });
  }

  await tx.assetComponent.deleteMany({ where: { assetId } });
  for (const p of byKey.values()) {
    let cat = await tx.componentCategory.findUnique({ where: { name: p.category } });
    if (!cat) cat = await tx.componentCategory.create({ data: { name: p.category } });
    let model = await tx.componentModel.findUnique({
      where: { categoryId_name_brand: { categoryId: cat.id, name: p.name, brand: p.brand } },
    });
    if (!model) {
      model = await tx.componentModel.create({
        data: { categoryId: cat.id, name: p.name, brand: p.brand },
      });
    }
    await tx.assetComponent.upsert({
      where: { assetId_modelId: { assetId, modelId: model.id } },
      create: { assetId, modelId: model.id, quantity: p.quantity },
      update: { quantity: p.quantity },
    });
  }
}

export async function POST(req: NextRequest) {
  const expected = process.env.DEVICE_CHECK_TOKEN?.trim();
  if (expected) {
    const got = req.headers.get("x-device-token")?.trim();
    if (got !== expected) {
      return NextResponse.json({ error: "令牌不匹配" }, { status: 401 });
    }
  }

  let body: RegisterBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const departmentName = String(body.department ?? "").trim();
  const employeeName = String(body.employeeName ?? "").trim();
  const hostAssetNo = String(body.hostAssetNo ?? "").trim().toUpperCase();
  const hostModel = String(body.host?.model ?? "").trim();
  const hostSerial = String(body.host?.serial ?? "").trim() || null;
  const hostBrand = String(body.host?.brand ?? "").trim() || null;
  const hostNotes = String(body.host?.notes ?? "").trim();
  const hostParts = Array.isArray(body.host?.parts) ? body.host!.parts : undefined;
  const monitorModel = String(body.monitor?.model ?? "").trim() || null;
  const monitorSerial = String(body.monitor?.serial ?? "").trim() || null;
  const monitorBrand = String(body.monitor?.brand ?? "").trim() || null;
  const monitorNotes = String(body.monitor?.notes ?? "").trim();
  const monitorAssetNo = String(body.monitorAssetNo ?? "").trim().toUpperCase() || null;
  const hostname = String(body.hostname ?? "").slice(0, 100) || "未知主机";

  if (!departmentName || !employeeName || (!hostModel && !hostAssetNo)) {
    return NextResponse.json(
      { error: "部门、员工姓名必填；主机型号与已有主机编号至少填一个" },
      { status: 400 }
    );
  }

  try {
    const payload = await prisma.$transaction(async (tx) => {
      // ── 1) 分类与直录模板（只在需要新建设备时才保证存在） ──
      const hostNeedCreate = !hostAssetNo;
      const hostCatName = body.host?.isLaptop ? "笔记本" : "台式机";
      const hostCategory = hostNeedCreate ? await ensureCategory(tx, hostCatName) : null;
      const hostTemplate = hostNeedCreate ? await ensureDirectTemplate(tx, hostCategory!.id) : null;
      const monitorNeedCreate = Boolean(monitorModel || monitorAssetNo) && !monitorAssetNo;
      let monitorCategory = null as Awaited<ReturnType<typeof ensureCategory>> | null;
      let monitorTemplate = null as Awaited<ReturnType<typeof ensureDirectTemplate>> | null;
      if (monitorNeedCreate) {
        monitorCategory = await ensureCategory(tx, "显示器");
        monitorTemplate = await ensureDirectTemplate(tx, monitorCategory.id);
      }

      // ── 2) 部门：没有就创建（同名复用，绝不重复建） ──
      let department = await tx.department.findUnique({ where: { name: departmentName } });
      const deptAction = department ? "EXISTS" : "CREATED";
      if (!department) {
        department = await tx.department.create({ data: { name: departmentName } });
      }

      // ── 3) 员工：优先「姓名+部门」精确匹配，其次同名在职（复用，绝不重复建）；都没有才创建 ──
      let employee = await tx.employee.findFirst({
        where: { name: employeeName, departmentId: department.id, status: "ACTIVE" },
        select: { id: true, name: true, employeeNo: true, departmentId: true },
      });
      let empAction: "CREATED" | "EXISTS" = "EXISTS";
      let empNote: string | null = null;
      if (!employee) {
        employee = await tx.employee.findFirst({
          where: { name: employeeName, status: "ACTIVE" },
          orderBy: { id: "asc" },
          select: { id: true, name: true, employeeNo: true, departmentId: true },
        });
        if (employee) {
          empNote = "已有同名在职员工（原属其他部门），已直接使用，未重复创建";
        }
      }
      if (!employee) {
        // 工号同时是登录账号（Admin.username = 工号），删员工不删账号（孤儿账号保留）。
        // 生成必须把 Admin 已占用的号一并计入，否则撞唯一约束整单 500。
        const [allNos, adminUsernames] = await Promise.all([
          tx.employee.findMany({ select: { employeeNo: true } }),
          tx.admin.findMany({ select: { username: true } }),
        ]);
        const employeeNo = generateEmployeeNo(employeeName, [
          ...allNos.map((e) => e.employeeNo),
          ...adminUsernames.map((a) => a.username),
        ]);
        employee = await tx.employee.create({
          data: { employeeNo, name: employeeName, departmentId: department.id },
          select: { id: true, name: true, employeeNo: true, departmentId: true },
        });
        const empRole = await tx.role.findUnique({ where: { key: "EMPLOYEE" } });
        const hashed = await bcrypt.hash("123456", 10);
        await tx.admin.create({
          data: {
            username: employeeNo,
            password: hashed,
            roleId: empRole?.id ?? null,
            displayName: employeeName,
            employeeId: employee.id,
            mustChangePassword: true,
          },
        });
        empAction = "CREATED";
      }
      const emp = employee;

      // ── 4) 单台设备登记 ──
      const registerOne = async (a: {
        kind: "host" | "monitor";
        model: string;
        serial: string | null;
        brand: string | null;
        notes: string;
        category: NonNullable<Awaited<ReturnType<typeof ensureCategory>>> | null;
        template: NonNullable<Awaited<ReturnType<typeof ensureDirectTemplate>>> | null;
        existingNo: string | null;
        parts?: RegisterPartInput[];
      }): Promise<RegisterItemResult> => {
        // 4-0) 已有编号：把现场配置写入该记录（不新建、不查重）
        if (a.existingNo) {
          const asset = await tx.asset.findFirst({
            where: { assetNo: a.existingNo, status: { in: [...HOLDING] } },
            select: {
              id: true, assetNo: true, model: true, serialNo: true, employeeId: true,
              employee: { select: { name: true } },
              template: { select: { name: true, category: { select: { name: true } } } },
            },
          });
          if (!asset) {
            return {
              kind: a.kind, action: "NOT_FOUND", assetNo: null, model: a.model, verdict: null,
              holder: null, message: `编号 ${a.existingNo} 在台账中不存在（或已报废/已归还），请核对`,
            };
          }
          // ⚠️ 编号已有人在用（持有人不是本次员工）→ 拦截写入，防止配置写错设备
          if (asset.employeeId && asset.employeeId !== emp.id) {
            return {
              kind: a.kind, action: "IN_USE", assetNo: asset.assetNo, model: asset.model,
              verdict: null, holder: asset.employee?.name ?? null,
              message: `该编号已在使用中（持有人：${asset.employee?.name ?? "他人"}），不能写入配置；请先在系统里归还/退库，或核实编号`,
            };
          }
          const catName = asset.template.category.name;
          const mismatch = catName && a.category && catName !== a.category.name
            ? `；注意：该编号在台账中属于「${catName}」分类`
            : "";
          const serialClash =
            asset.serialNo && a.serial && asset.serialNo !== a.serial
              ? `；序列号不一致（台账 ${asset.serialNo} / 现场 ${a.serial}），已按现场更新`
              : "";
          const notes = `现场登记（${hostname}）\n${a.notes}`.trim();
          await tx.asset.update({
            where: { id: asset.id },
            data: {
              model: a.model,
              ...(a.serial ? { serialNo: a.serial } : {}),
              ...(a.brand ? { brand: a.brand } : {}),
              notes,
              ...(asset.employeeId
                ? {}
                : { employeeId: emp.id, status: "IN_USE" as const }),
            },
          });
          await syncAssetComponents(tx, asset.id, asset.template?.name ?? null, a.parts);
          return {
            kind: a.kind, action: "WRITTEN", assetNo: asset.assetNo, model: a.model,
            verdict: null, holder: asset.employee?.name ?? emp.name,
            message:
              `配置已写入 ${asset.assetNo}（原型号: ${asset.model ?? "空"}）` +
              mismatch + serialClash +
              (asset.employeeId ? "" : `，并分配给 ${emp.name}`),
          };
        }

        // 4a) 序列号已登记过 → 返回既有台账并给出型号核对结论（不重复建档）
        if (a.serial) {
          const dup = await tx.asset.findFirst({
            where: { serialNo: a.serial },
            select: {
              assetNo: true, model: true, status: true,
              employee: { select: { name: true } },
              template: { select: { category: { select: { name: true } } } },
            },
          });
          if (dup) {
            return {
              kind: a.kind, action: "EXISTS", assetNo: dup.assetNo, model: dup.model,
              verdict: modelMatches(dup.model, a.model) ? "MATCH" : "MISMATCH",
              holder: dup.employee?.name ?? null,
              message: `已登记过（${dup.template.category.name}），本次未重复建档`,
            };
          }
        }

        // 4b) R4 唯一分类：同一员工至多 1 台
        const dupByEmp = await tx.asset.findFirst({
          where: {
            employeeId: emp.id,
            template: { categoryId: a.category!.id },
            status: { in: [...HOLDING] },
          },
          select: { assetNo: true, model: true },
        });
        if (a.category!.unique && dupByEmp) {
          return {
            kind: a.kind, action: "CONFLICT", assetNo: dupByEmp.assetNo, model: dupByEmp.model,
            verdict: null, holder: emp.name,
            message: `该员工在「${a.category!.name}」分类下已有 ${dupByEmp.assetNo}，且该分类每人限 1 台`,
          };
        }

        // 4c) 无序列号（或序列号是占位串）：同人 + 同分类 + 同型号视为同一台，避免重复建档
        if (!a.serial) {
          const sameModel = await tx.asset.findFirst({
            where: {
              employeeId: emp.id,
              template: { categoryId: a.category!.id },
              model: { not: null },
              status: { in: [...HOLDING] },
            },
            select: { assetNo: true, model: true, status: true },
          });
          if (sameModel && modelMatches(sameModel.model, a.model)) {
            return {
              kind: a.kind, action: "EXISTS", assetNo: sameModel.assetNo, model: sameModel.model,
              verdict: "MATCH", holder: emp.name,
              message: `名下已有同型号${a.category!.name}（${sameModel.assetNo}），未重复建档`,
            };
          }
        }

        // 4d) 建档：编号走分类编号规则，名字与网页端「新建即分配」口径一致
        const assetNo = await generateAssetNo(tx, a.category!.code, a.category!.numberingRule);
        const created = await tx.asset.create({
          data: {
            assetNo,
            name: `${emp.name}的${a.category!.name}`,
            templateId: a.template!.id,
            status: "IN_USE",
            employeeId: emp.id,
            brand: a.brand,
            model: a.model,
            serialNo: a.serial,
            notes: `现场登记（${hostname}）\n${a.notes}`.trim(),
          },
          select: { id: true },
        });
        await syncAssetComponents(tx, created.id, a.template?.name ?? null, a.parts);
        return {
          kind: a.kind, action: "CREATED", assetNo, model: a.model, verdict: null,
          holder: emp.name, message: `已建档并分配给 ${emp.name}`,
        };
      };

      const devices: RegisterItemResult[] = [];
      devices.push(
        await registerOne({
          kind: "host", model: hostModel, serial: hostSerial, brand: hostBrand,
          notes: hostNotes, category: hostCategory, template: hostTemplate,
          existingNo: hostAssetNo || null, parts: hostParts,
        })
      );
      if (monitorModel || monitorAssetNo) {
        devices.push(
          await registerOne({
            kind: "monitor", model: monitorModel ?? "", serial: monitorSerial,
            brand: monitorBrand, notes: monitorNotes,
            category: monitorCategory, template: monitorTemplate,
            existingNo: monitorAssetNo,
          })
        );
      }

      return {
        department: { name: department.name, action: deptAction },
        employee: { name: emp.name, employeeNo: emp.employeeNo, action: empAction, note: empNote },
        devices,
      };
      // 登记事务重（建部门/员工/账号/设备+分配），默认 maxWait 2s 太紧会报 P2028
    }, { maxWait: 10_000, timeout: 30_000 });

    const summary = payload.devices.map((d) => `${d.assetNo ?? "-"}[${d.action}]`).join(", ");
    await prisma.systemLog
      .create({
        data: {
          module: "设备核对",
          action: "现场登记",
          detail: `来自 ${hostname}：部门=${payload.department.name}(${payload.department.action})，员工=${payload.employee.name}/${payload.employee.employeeNo}(${payload.employee.action})，设备=${summary}`,
          operator: hostname,
        },
      })
      .catch(() => {});

    return NextResponse.json(payload);
  } catch (e) {
    console.error("[设备登记] 现场登记失败", e);
    return NextResponse.json({ error: "登记失败，请稍后重试" }, { status: 500 });
  }
}
