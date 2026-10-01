import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import { getCcRecordFilterOptions, getMyCcRecords } from "@/actions/approval.actions";
import { CcRecordsClient } from "./cc-records-client";

export const metadata: Metadata = { title: "我的抄送" };

export default async function CcRecordsPage() {
  const [optionsRes, dataRes] = await Promise.all([
    getCcRecordFilterOptions(),
    getMyCcRecords(),
  ]);

  const options = optionsRes.success
    ? optionsRes.data
    : { departments: [], initiators: [], componentCategories: [] };
  const initial = dataRes.success ? dataRes.data : [];

  return <CcRecordsClient initial={initial} options={options} />;
}
