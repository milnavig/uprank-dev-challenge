// Adapted from shadcn/ui new-york-v4 button.tsx, retrieved 2026-11-17.
// Origin and MIT license: ./LICENSE.shadcn.md. Local changes: CSS classes, reduced variants.
import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./utils";
const buttonVariants = cva("button", {
  variants: { variant: { default: "button-primary", outline: "button-outline", ghost: "button-ghost" } },
  defaultVariants: { variant: "default" },
});
export function Button({ className, variant, asChild = false, ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant }), className)} {...props} />;
}
