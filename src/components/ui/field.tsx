import { forwardRef, useId } from "react";
import { cn } from "@/lib/utils";

const controlBase =
  "block w-full rounded-lg border bg-white px-3 text-[0.9375rem] text-ink-900 shadow-[inset_0_1px_1px_rgb(15_32_24/0.03)] transition-colors placeholder:text-ink-400 hover:border-ink-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/12 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-500";

export function controlClass(invalid?: boolean, className?: string) {
  return cn(controlBase, invalid ? "border-red-400 focus:border-red-500 focus:ring-red-500/12" : "border-ink-200", className);
}

interface FieldProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  optionalLabel?: string;
  className?: string;
  children: (id: string, describedBy: string | undefined) => React.ReactNode;
}

/** Label + control + hint + error, wired up for screen readers. */
export function Field({ label, hint, error, required, optionalLabel, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-sm font-medium text-ink-800">
          <span>
            {label}
            {required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
          </span>
          {!required && optionalLabel && <span className="text-xs font-normal text-ink-400">{optionalLabel}</span>}
        </label>
      )}
      {children(id, describedBy)}
      {hint && !error && (
        <p id={hintId} className="text-xs leading-relaxed text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  optionalLabel?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  containerClassName?: string;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, required, optionalLabel, leading, trailing, className, containerClassName, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} optionalLabel={optionalLabel} className={containerClassName}>
      {(id, describedBy) => (
        <div className="relative">
          {leading && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-400">{leading}</span>}
          <input
            ref={ref}
            id={id}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={controlClass(Boolean(error), cn("h-10", leading && "pl-9", trailing && "pr-10", className))}
            {...rest}
          />
          {trailing && <span className="absolute inset-y-0 right-2 flex items-center">{trailing}</span>}
        </div>
      )}
    </Field>
  );
});

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  optionalLabel?: string;
  containerClassName?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, optionalLabel, className, containerClassName, children, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} optionalLabel={optionalLabel} className={containerClassName}>
      {(id, describedBy) => (
        <select
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={controlClass(
            Boolean(error),
            cn(
              "h-10 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%236b7a72%22><path d=%22M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z%22/></svg>')] bg-[length:1.1rem] bg-[right_0.6rem_center] bg-no-repeat pr-9",
              className,
            ),
          )}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
});

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  optionalLabel?: string;
  containerClassName?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, optionalLabel, className, containerClassName, rows = 3, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required} optionalLabel={optionalLabel} className={containerClassName}>
      {(id, describedBy) => (
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={controlClass(Boolean(error), cn("py-2 leading-relaxed", className))}
          {...rest}
        />
      )}
    </Field>
  );
});

export function Checkbox({
  label,
  description,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; description?: React.ReactNode }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 bg-white p-3 transition-colors hover:border-ink-300 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 rounded border-ink-300 accent-brand-700"
        {...rest}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{description}</span>}
      </span>
    </label>
  );
}
