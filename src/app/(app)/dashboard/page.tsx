import { permanentRedirect } from "next/navigation";

export default function DashboardRedirect() {
  permanentRedirect("/overview");
}
