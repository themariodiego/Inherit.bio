"use client";

import { IntentLink } from "@/components/site/intent-link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";

/**
 * One header nav entry. The only client-side thing it does is read the
 * pathname and mark the current route with `aria-current="page"`, which
 * globals.css already underlines; the header itself stays a server component.
 */
export function SiteNavLink({ href, ...props }: ComponentProps<typeof IntentLink> & { href: string }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return <IntentLink href={href} aria-current={current ? "page" : undefined} {...props} />;
}
