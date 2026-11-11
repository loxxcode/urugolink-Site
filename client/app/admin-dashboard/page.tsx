import type { Metadata } from "next";
import AdminDashboard from "../admin-dashboard";

export const metadata: Metadata = {
  title: "Admin · UrugoLink",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <AdminDashboard />;
}