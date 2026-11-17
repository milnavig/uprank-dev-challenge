"use client";
// Adapted from shadcn/ui new-york-v4 table.tsx, retrieved 2026-11-17.
// Origin and MIT license: ./LICENSE.shadcn.md. Local changes: CSS classes and accessible overflow controls.
import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "./utils";
export function Table({ className, "aria-label": label, ...props }: ComponentProps<"table">) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ overflow: false, left: false, right: false });
  function updateScroll() {
    const element = container.current;
    if (!element) return;
    const maximum = element.scrollWidth - element.clientWidth;
    setScroll({ overflow: maximum > 1, left: element.scrollLeft > 1, right: element.scrollLeft < maximum - 1 });
  }
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(updateScroll);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    updateScroll();
    return () => observer.disconnect();
  }, []);
  function move(direction: number) {
    const element = container.current;
    if (element) element.scrollBy({ left: direction * Math.max(200, element.clientWidth * .75), behavior: "instant" });
  }
  return <>{scroll.overflow && <div className="table-scroll-controls" role="group" aria-label={`${label ?? "Data table"} column navigation`}><span>More columns · swipe or use arrows</span><button type="button" aria-label="Scroll columns left" aria-controls={id} disabled={!scroll.left} onClick={() => move(-1)}><ChevronLeft aria-hidden="true" /></button><button type="button" aria-label="Scroll columns right" aria-controls={id} disabled={!scroll.right} onClick={() => move(1)}><ChevronRight aria-hidden="true" /></button></div>}<div ref={container} id={id} data-slot="table-container" className="table-scroll" tabIndex={scroll.overflow ? 0 : undefined} role="region" onScroll={updateScroll} aria-label={label ?? "Data table"}><table data-slot="table" aria-label={label} className={cn("data-table", className)} {...props} /></div></>;
}
export function TableHeader(props: ComponentProps<"thead">) { return <thead data-slot="table-header" {...props} />; }
export function TableBody(props: ComponentProps<"tbody">) { return <tbody data-slot="table-body" {...props} />; }
export function TableRow(props: ComponentProps<"tr">) { return <tr data-slot="table-row" {...props} />; }
export function TableHead(props: ComponentProps<"th">) { return <th scope="col" data-slot="table-head" {...props} />; }
export function TableCell(props: ComponentProps<"td">) { return <td data-slot="table-cell" {...props} />; }
