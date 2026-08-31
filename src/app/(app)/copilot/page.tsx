import { permanentRedirect } from "next/navigation";

export default function CopilotRedirect() {
  permanentRedirect("/copilot/me");
}
