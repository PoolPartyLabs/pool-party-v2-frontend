import { HomeSkeleton } from "@/features/home/components/HomeSkeleton";

/** Loading skeleton for the Home dashboard (PP-DASH-SCR-001); also the app-wide fallback. */
export default function Loading() {
  return <HomeSkeleton />;
}
