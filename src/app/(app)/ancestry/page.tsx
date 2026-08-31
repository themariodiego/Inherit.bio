import { redirect } from "next/navigation";

export default function AncestryRedirect() {
  redirect("/genome/me/ancestry");
}
