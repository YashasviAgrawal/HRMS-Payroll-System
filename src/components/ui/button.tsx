import Link from "next/link";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:pointer-events-none disabled:opacity-55 select-none";

const variants: Record<ButtonVariant, string> = {
  // The one dark primary button per screen (PRD §16).
  primary: "bg-brand-700 text-white shadow-sm shadow-brand-900/20 hover:bg-brand-800 active:bg-brand-900",
  secondary: "border border-ink-200 bg-white text-ink-800 shadow-card hover:border-ink-300 hover:bg-ink-50 active:bg-ink-100",
  ghost: "text-ink-700 hover:bg-ink-100 active:bg-ink-200",
  danger: "border border-red-200 bg-white text-red-700 shadow-card hover:bg-red-50 hover:border-red-300",
  subtle: "bg-brand-50 text-brand-800 hover:bg-brand-100 active:bg-brand-200",
  link: "text-brand-700 underline-offset-4 hover:underline px-0! h-auto!",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: { href: string; variant?: ButtonVariant; size?: ButtonSize; icon?: React.ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
>) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
