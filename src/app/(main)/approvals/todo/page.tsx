import type { Metadata } from "next";
export const dynamic = "force-dynamic";

import { TodoClient } from "./todo-client";

export const metadata: Metadata = { title: "我的待办" };

export default async function TodoPage() {
  return <TodoClient />;
}
