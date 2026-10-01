import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import {
  getHandledRecordFilterOptions,
  getMyHandledRecords,
} from "@/actions/approval.actions";
import { DoneRecordsClient } from "./done-records-client";

export const metadata: Metadata = { title: "我办理的记录" };

export default async function DoneRecordsPage() {
  const [optionsRes, dataRes] = await Promise.all([
    getHandledRecordFilterOptions(),
    getMyHandledRecords(),
  ]);

  const options = optionsRes.success
    ? optionsRes.data
    : { canViewAll: false, departments: [], initiators: [], componentCategories: [] };
  const initial = dataRes.success ? dataRes.data : [];

  return <DoneRecordsClient initial={initial} options={options} />;
}