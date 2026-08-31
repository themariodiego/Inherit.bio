import { redirect } from "next/navigation";

export default async function ReportRedirect(
  props: PageProps<"/reports/[slug]">,
) {
  const { slug } = await props.params;
  redirect(`/genome/me/reports/${encodeURIComponent(slug)}`);
}
