"use client";

import { useRouter } from "next/navigation";
import { Tr } from "./table";

/** A table row that opens a page on click or Enter (keyboard-first grids). */
export function RowLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <Tr
      interactive
      className={className}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,input,select,textarea")) return;
        router.push(href);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
    >
      {children}
    </Tr>
  );
}
