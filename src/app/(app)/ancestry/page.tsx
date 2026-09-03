import { permanentRedirect } from "next/navigation";

export default function AncestryRedirect() {
  permanentRedirect("/genome/me/ancestry");
}
