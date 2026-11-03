import { forwardRef, type ComponentProps, type HTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-10 w-full rounded-lg border bg-surface px-3 text-sm text-foreground shadow-xs transition-colors placeholder:text-muted/70",
      "focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/15",
      "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15 disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Label = ({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn("text-sm font-medium text-foreground", className)} {...props} />
);

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint}
      </div>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const Card = ({ className, ...props }: ComponentProps<"div">) => (
  <div className={cn("rounded-xl border bg-surface shadow-xs", className)} {...props} />
);

export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex items-start justify-between gap-4 p-5 pb-0", className)} {...props} />
);

export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn("text-sm font-semibold text-foreground", className)} {...props} />
);

export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("mt-0.5 text-xs text-muted", className)} {...props} />
);

export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-5", className)} {...props} />
);

export const Skeleton = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div
    aria-hidden
    className={cn(
      "relative overflow-hidden rounded-md bg-surface-muted",
      "before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.6s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/40 before:to-transparent dark:before:via-white/5",
      className,
    )}
    {...props}
  />
);

const badgeTones = {
  neutral: "bg-surface-muted text-muted",
  primary: "bg-primary-soft text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
} as const;

export const Badge = ({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) => (
  <span
    className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", badgeTones[tone], className)}
    {...props}
  />
);

export const Kbd = ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
  <kbd
    className={cn("rounded border bg-surface-muted px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted", className)}
    {...props}
  />
);
