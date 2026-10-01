import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import { MyRequestsClient } from "./my-requests-client";

export const metadata: Metadata = { title: "我的申请" };

export default async function MyRequestsPage() {
  return <MyRequestsClient />;
}
