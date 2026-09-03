import { permanentRedirect } from "next/navigation";

export default function ReportsRedirect() {
  permanentRedirect("/genome/me/reports");
}
