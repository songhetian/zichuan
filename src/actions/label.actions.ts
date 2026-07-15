"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  assetIds: z.array(z.number()).optional(),
  employeeId: z.number().optional(),
  departmentName: z.string().optional(),
});

type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

type LabelData = {
  assetNo: string;
  name: string;
  employeeName: string;
  departmentName: string;
  location: string | null;
  components: {
    modelName: string;
    brand: string | null;
    quantity: number;
  }[];
};

export async function generateLabelData(
  input: z.infer<typeof querySchema>
): Promise<ActionResult<LabelData[]>> {
  const validated = querySchema.safeParse(input);
  if (!validated.success) {
    return { success: false, error: "参数错误" };
  }

  const where: any = {};
  if (validated.data.assetIds != null && validated.data.assetIds.length > 0) {
    where.id = { in: validated.data.assetIds };
  }
  if (validated.data.employeeId != null) {
    where.employeeId = validated.data.employeeId;
  }
  if (validated.data.departmentName != null && validated.data.departmentName !== "") {
    where.employee = { department: { name: validated.data.departmentName } };
  }

  const assets = await prisma.asset.findMany({
    where,
    orderBy: { assetNo: "asc" },
    include: {
      employee: {
        select: {
          name: true,
          department: { select: { name: true } },
        },
      },
      components: {
        include: {
          model: { select: { name: true, brand: true } },
        },
      },
    },
  });

  const data: LabelData[] = assets.map((a) => ({
    assetNo: a.assetNo,
    name: a.name,
    employeeName: a.employee?.name ?? "",
    departmentName: a.employee?.department?.name ?? "",
    location: a.location,
    components: a.components.map((c) => ({
      modelName: c.model?.name ?? "",
      brand: c.model?.brand ?? null,
      quantity: c.quantity,
    })),
  }));

  return { success: true, data };
}
