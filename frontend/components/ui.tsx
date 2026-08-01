import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

export type ButtonVariant = "solid" | "ink" | "outline" | "quiet" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function buttonClassName({
  variant = "solid",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "ui-button",
    `ui-button--${variant}`,
    `ui-button--${size}`,
    className,
  );
}

export function Button({
  variant = "solid",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={buttonClassName({ variant, size, className })}
      type={type}
      {...props}
    />
  );
}

export function Badge({
  tone = "neutral",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "signal" | "success" | "ink";
  children: ReactNode;
}) {
  return (
    <span className={cn("ui-badge", `ui-badge--${tone}`, className)} {...props}>
      {children}
    </span>
  );
}

export function Card({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn("ui-card", className)} {...props}>
      {children}
    </div>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("ui-input", className)} {...props} />;
}

export function SelectField({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={cn("ui-select", className)} {...props}>
      {children}
    </select>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("ui-divider", className)} aria-hidden="true" />;
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("ui-skeleton", className)} aria-hidden="true" />;
}

