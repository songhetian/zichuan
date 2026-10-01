import type { Metadata } from "next";
import { NotificationsClient } from "./notifications-client";

export const metadata: Metadata = { title: "通知中心" };

export default function NotificationsPage() {
  return <NotificationsClient />;
}
