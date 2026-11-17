// Adapted from shadcn/ui new-york-v4 badge.tsx, retrieved 2026-11-17.
// Origin and MIT license: ./LICENSE.shadcn.md. Local changes: CSS classes, reduced variants.
import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";
const badgeVariants = cva("badge", { variants: { variant: { default: "badge-teal", outline: "badge-outline", warning: "badge-warning", danger: "badge-danger" } }, defaultVariants: { variant: "default" } });
export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
