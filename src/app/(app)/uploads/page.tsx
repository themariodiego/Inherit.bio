import { permanentRedirect } from "next/navigation";

export default function UploadsRedirect() {
  permanentRedirect("/files");
}
