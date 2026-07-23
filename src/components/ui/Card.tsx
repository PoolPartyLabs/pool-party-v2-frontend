/**
 * @id PP-CORE-CMP-012
 * @name Card
 * @implements-rules-version v1
 * Presentational card primitive plus composable header, title, description, content, and footer parts.
 */
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/** Props for the {@link Card} container; forwards all native `<div>` attributes. */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {}

/**
 * Surface container with token-driven background, border, and radius.
 * Compose with {@link CardHeader}, {@link CardContent}, and {@link CardFooter}.
 */
export function Card({ className, ...props }: CardProps) {
  return <div className={cn("bg-surface border border-border rounded-lg", className)} {...props} />;
}

/** Props for {@link CardHeader}; forwards all native `<div>` attributes. */
export interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {}

/** Top section of a card; stacks a {@link CardTitle} and {@link CardDescription} with spacing. */
export function CardHeader({ className, ...props }: CardHeaderProps) {
  return <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />;
}

/** Props for {@link CardTitle}; forwards all native heading attributes. */
export interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {}

/** Prominent card heading rendered as an `<h3>`. */
export function CardTitle({ className, ...props }: CardTitleProps) {
  return <h3 className={cn("text-lg font-semibold", className)} {...props} />;
}

/** Props for {@link CardDescription}; forwards all native paragraph attributes. */
export interface CardDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {}

/** Secondary, muted supporting text rendered as a `<p>`. */
export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

/** Props for {@link CardContent}; forwards all native `<div>` attributes. */
export interface CardContentProps extends HTMLAttributes<HTMLDivElement> {}

/** Main body region of a card with padding, no top padding so it sits below the header. */
export function CardContent({ className, ...props }: CardContentProps) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

/** Props for {@link CardFooter}; forwards all native `<div>` attributes. */
export interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {}

/** Bottom region of a card, typically holding actions, laid out as a horizontal row. */
export function CardFooter({ className, ...props }: CardFooterProps) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}
