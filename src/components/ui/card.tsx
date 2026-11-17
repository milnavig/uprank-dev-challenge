// Adapted from shadcn/ui new-york-v4 card.tsx, retrieved 2026-11-17.
// Origin and MIT license: ./LICENSE.shadcn.md. Local change: dashboard CSS classes.
import type { ComponentProps } from "react";
import { cn } from "./utils";
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card" className={cn("card", className)} {...props} />;
}
export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("card-header", className)} {...props} />;
}
export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("card-content", className)} {...props} />;
}
