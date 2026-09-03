import { permanentRedirect } from "next/navigation";

export default async function ReportRedirect(
  props: PageProps<"/reports/[slug]">,
) {
  const { slug } = await props.params;
  permanentRedirect(`/genome/me/reports/${encodeURIComponent(slug)}`);
}
