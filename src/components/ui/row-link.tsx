"use client";

import Link from "next/link";
import { Children, cloneElement, isValidElement } from "react";
import { useRouter } from "next/navigation";
import { Tr } from "./table";

/**
 * A table row that opens a page. The first cell holds a real link (its own, or one made here) — screen
 * readers announce it, Tab reaches it, Enter or a middle-click opens it — and a click anywhere else on the
 * row does the same (keyboard-first grids, WCAG 4.1.2).
 */
/** Whether the cell already holds a link (a link inside a link is not allowed). */
function hasLink(node: React.ReactNode): boolean {
  return Children.toArray(node).some(
    (child) => isValidElement<{ children?: React.ReactNode; href?: unknown }>(child) && (child.type === "a" || child.type === Link || typeof child.props.href === "string" || hasLink(child.props.children)),
  );
}

export function RowLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  const [first, ...rest] = Children.toArray(children);
  const firstCell = isValidElement<{ children?: React.ReactNode }>(first) && !hasLink(first.props.children)
    ? cloneElement(
        first,
        undefined,
        <Link href={href} className="-m-1 block rounded-md p-1 text-inherit focus-visible:outline-2 focus-visible:outline-brand-600">
          {first.props.children}
        </Link>,
      )
    : first;
  return (
    <Tr
      interactive
      className={className}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
        router.push(href);
      }}
    >
      {firstCell}
      {rest}
    </Tr>
  );
}
