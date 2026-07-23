/**
 * @id PP-PROF-SCR-004
 * @name Security & login
 * @implements-rules-version v2
 *
 * v1 scope: only Export private key, Log out (on the hub), and Delete account are functional.
 * Everything else (change password / Face ID / app lock / 2FA / trusted devices / active sessions /
 * login alerts) is shown as a non-interactive "Coming soon" row. Export private key reveals the key
 * only behind a deliberate hold-to-reveal gate (ExportKeyDialog); Delete account is gated behind
 * withdrawing funds first (the account must be empty and irreversibility is made explicit). Wrapped in
 * the shared SettingsLayout.
 *
 * v2 (POO-544): the export is wired to the real Privy exportWallet() for embedded wallets (via
 * ExportKeyDialog + useExportPrivateKey); the real key is rendered by Privy in its own cross-origin
 * iframe and never enters our code. In real mode the export row stays hidden until the wallet kind
 * resolves, so an external-wallet user never sees the affordance flash (R2).
 */
"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useRouter } from "@/i18n/navigation";
import type { WalletKind } from "@/lib/account/getWalletKind";
import { useAccountService } from "@/lib/account/useAccountService";
import { isMockMode } from "@/lib/services";
import { ExportKeyDialog } from "./components/ExportKeyDialog";
import { SettingsLayout } from "./components/SettingsLayout";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";

/** Security & login. */
export function SecurityScreen() {
  const t = useTranslations("profile");
  const router = useRouter();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const soon = t("security.comingSoon");

  // Export private key is only meaningful for embedded (Google/Privy) wallets — external-wallet users
  // hold their own key, so they must not see the affordance (POO-344 / POO-223 acceptance). In mock
  // mode default "embedded" so the row shows immediately (mock + the Google persona). In real mode
  // default "loading" so a genuine external user never sees the export flash before the async wallet
  // kind resolves (POO-544 R2); it appears only once it resolves to "embedded".
  const account = useAccountService();
  const [walletKind, setWalletKind] = useState<WalletKind | "loading">(
    isMockMode ? "embedded" : "loading",
  );
  useEffect(() => {
    let active = true;
    account.getWalletKind().then((kind) => {
      if (active) setWalletKind(kind);
    });
    return () => {
      active = false;
    };
  }, [account]);
  const showExport = walletKind === "embedded";

  // PP-INTEGRATION-POINT: gate deletion on a zero balance + no open positions (account service).
  // The mock investor is funded, so account deletion stays blocked until they withdraw everything.
  const hasWithdrawableFunds = true;

  function handleDelete() {
    if (hasWithdrawableFunds) setBlockedOpen(true);
    else setDeleteOpen(true);
  }

  return (
    <SettingsLayout title={t("security.title")}>
      <SettingsSection label={t("security.signIn")}>
        <SettingsRow title={t("security.changePassword")} value={soon} comingSoon />
        <SettingsRow title={t("security.faceId")} value={soon} comingSoon />
        <SettingsRow title={t("security.appLock")} value={soon} comingSoon />
        <SettingsRow title={t("security.twoFactor")} value={soon} comingSoon />
      </SettingsSection>

      {showExport ? (
        <div>
          <SettingsSection label={t("security.wallet")}>
            <SettingsRow title={t("security.exportKey")} onClick={() => setExportOpen(true)} />
          </SettingsSection>
          <p className="mt-2 px-1 text-warning text-xs">{t("security.exportWarning")}</p>
          {/* Hold-to-reveal gate. Mock reveals a 0xMOCK value; real opens Privy's secure iframe. */}
          <ExportKeyDialog open={exportOpen} onOpenChange={setExportOpen} />
        </div>
      ) : null}

      <SettingsSection label={t("security.devices")}>
        <SettingsRow title={t("security.trustedDevices")} value={soon} comingSoon />
        <SettingsRow title={t("security.activeSessions")} value={soon} comingSoon />
        <SettingsRow title={t("security.loginAlerts")} value={soon} comingSoon />
      </SettingsSection>

      <SettingsSection>
        <SettingsRow title={t("security.deleteAccount")} danger onClick={handleDelete} />
      </SettingsSection>

      {/* Funds remain → block deletion and point the user to withdraw first. Informational, not
          destructive: the action it offers (go to portfolio) is safe. */}
      <ConfirmDialog
        open={blockedOpen}
        onOpenChange={setBlockedOpen}
        tone="info"
        title={t("security.deleteBlocked.title")}
        body={t("security.deleteBlocked.body")}
        confirmLabel={t("security.deleteBlocked.confirm")}
        cancelLabel={t("cancel")}
        onConfirm={() => {
          setBlockedOpen(false);
          router.push("/portfolio");
        }}
      />

      {/* Reachable only once the account is empty. */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("security.deleteConfirm.title")}
        body={t("security.deleteConfirm.body")}
        confirmLabel={t("security.deleteConfirm.confirm")}
        cancelLabel={t("cancel")}
        onConfirm={() => {}}
      />
    </SettingsLayout>
  );
}
