import type { Employee } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateEmployeeNo } from "@/lib/employee-no";
import bcrypt from "bcryptjs";

/** 演示组织数据的默认初始密码（全员统一，可后续自行修改） */
export const ORG_BOOTSTRAP_DEFAULT_PASSWORD = "123456";

export interface OrgDeptSpec {
  name: string;
  employeeCount: number;
}

export interface OrgBootstrapResult {
  skipped: boolean;
  departments: number;
  employees: number;
  admins: number;
}

const SURNAMES = ["张", "王", "李", "赵", "刘", "陈", "杨", "黄", "周", "吴", "徐", "孙", "马", "朱", "胡", "郭", "何", "林", "罗", "高", "郑", "梁", "谢", "宋", "唐", "许", "韩", "冯", "邓", "曹", "彭", "曾", "肖", "田", "董", "袁", "潘", "蒋", "蔡", "余", "杜", "叶", "程", "苏", "魏", "吕", "丁", "任", "沈", "姚", "卢", "姜", "崔", "钟", "谭", "陆", "汪", "范", "金", "石", "廖", "贾", "夏", "韦", "付", "方", "白", "邹", "孟", "熊", "秦", "邱", "江", "尹", "薛", "闫", "段", "雷", "侯", "龙", "史", "陶", "黎", "贺", "顾", "毛", "郝", "龚", "邵", "万", "钱", "严", "覃", "武", "戴", "莫", "孔", "向", "汤"];
const GIVEN = ["伟", "芳", "娜", "秀英", "敏", "静", "丽", "强", "磊", "军", "洋", "勇", "艳", "杰", "娟", "涛", "明", "超", "秀兰", "霞", "平", "刚", "桂英", "文", "辉", "鑫", "浩", "宇", "欣", "婷", "雪", "宁", "飞", "鹏", "峰", "磊", "凯", "晨", "东", "华"];

function randomName(existing: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    const name =
      SURNAMES[Math.floor(Math.random() * SURNAMES.length)] +
      GIVEN[Math.floor(Math.random() * GIVEN.length)];
    if (!existing.has(name)) {
      existing.add(name);
      return name;
    }
  }
  return `员工${existing.size + 1}`;
}

function randomPhone(): string {
  const prefixes = ["138", "139", "150", "151", "158", "159", "186", "188"];
  const head = prefixes[Math.floor(Math.random() * prefixes.length)];
  let tail = "";
  for (let i = 0; i < 8; i++) tail += Math.floor(Math.random() * 10);
  return head + tail;
}

/**
 * 组织数据补全：部门 + 员工 + 主管指派 + 全员登录账号（幂等）。
 * 规则：每部门第 1 名员工（employeeNo 最小）任部门主管；其余员工直属主管指向本部门主管；
 * 账号用户名 = 工号，初始密码统一，部门主管角色 DEPT_MANAGER、其余 EMPLOYEE。
 * 已存在员工数据时整体跳过，不重复建。
 */
export async function bootstrapOrgData(
  specs: OrgDeptSpec[]
): Promise<OrgBootstrapResult> {
  const deptMgrRole = await prisma.role.upsert({
    where: { key: "DEPT_MANAGER" },
    update: {},
    create: { key: "DEPT_MANAGER", name: "部门主管", isSystem: true },
  });
  const employeeRole = await prisma.role.upsert({
    where: { key: "EMPLOYEE" },
    update: {},
    create: { key: "EMPLOYEE", name: "普通员工", isSystem: true },
  });
  const assetMgrRole = await prisma.role.upsert({
    where: { key: "ASSET_MANAGER" },
    update: {},
    create: { key: "ASSET_MANAGER", name: "资产管理员", isSystem: true },
  });

  const passwordHash = await bcrypt.hash(ORG_BOOTSTRAP_DEFAULT_PASSWORD, 10);
  const usedNames = new Set<string>();

  // 默认流程 n2「资产管理员审批」按角色解析：每次调用都保证有启用账号（审批基础设施）
  let adminCount = 0;
  const existingAssetMgr = await prisma.admin.findFirst({
    where: { role: { key: "ASSET_MANAGER" }, isActive: true },
  });
  if (!existingAssetMgr) {
    await prisma.admin.create({
      data: {
        username: "assetmgr",
        password: passwordHash,
        displayName: "资产管理员",
        roleId: assetMgrRole.id,
      },
    });
    adminCount++;
  }

  const existingEmp = await prisma.employee.count();
  if (existingEmp > 0) {
    return { skipped: true, departments: 0, employees: 0, admins: adminCount };
  }

  let employeeCount = 0;

  await prisma.$transaction(async (tx) => {
    const existingNos = (await tx.employee.findMany({ select: { employeeNo: true } })).map(
      (e) => e.employeeNo
    );

    for (const spec of specs) {
      const dept = await tx.department.create({ data: { name: spec.name } });

      let headId: number | null = null;
      for (let i = 0; i < spec.employeeCount; i++) {
        const employeeNo = generateEmployeeNo(existingNos);
        existingNos.push(employeeNo);
        const emp: Employee = await tx.employee.create({
          data: {
            employeeNo,
            name: randomName(usedNames),
            departmentId: dept.id,
            phone: randomPhone(),
            managerId: headId,
          },
        });
        if (headId === null) headId = emp.id;
        employeeCount++;

        await tx.admin.create({
          data: {
            username: employeeNo,
            password: passwordHash,
            displayName: emp.name,
            roleId: emp.id === headId ? deptMgrRole.id : employeeRole.id,
            employeeId: emp.id,
          },
        });
        adminCount++;
      }

      // 部门首人任部门主管
      await tx.department.update({ where: { id: dept.id }, data: { managerId: headId } });
    }
  });

  return { skipped: false, departments: specs.length, employees: employeeCount, admins: adminCount };
}
