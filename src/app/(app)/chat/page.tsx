import { permanentRedirect } from "next/navigation";

export default function ChatRedirect() {
  permanentRedirect("/copilot/me");
}
