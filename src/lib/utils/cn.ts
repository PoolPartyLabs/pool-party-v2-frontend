/**
 * @id PP-CORE (design-system utility)
 * @name cn
 *
 * Merge class names with clsx, then de-conflict Tailwind utilities (Tailwind 4 aware via
 * tailwind-merge v3). Every design-system primitive uses this for className composition so a
 * consumer-supplied `className` can override defaults predictably.
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
