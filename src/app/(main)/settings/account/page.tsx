import type { Metadata } from "next";
export const dynamic = 'force-dynamic';

import { AccountClient } from "./account-client";

export const metadata: Metadata = { title: "账号设置" };

export default async function AccountPage() {
  return <AccountClient />;
}