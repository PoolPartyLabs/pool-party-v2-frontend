import { setRequestLocale } from "next-intl/server";
import { SignInScreen } from "@/features/auth/SignInScreen";

/** Route for PP-AUTH-SCR-001 — the unified sign in / sign up entry. */
export default async function SignInPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SignInScreen />;
}
