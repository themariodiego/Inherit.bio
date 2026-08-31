import { permanentRedirect } from "next/navigation";

export default function BrowseRedirect() {
  permanentRedirect("/genome/me/data/browser");
}
