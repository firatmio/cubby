import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { useT } from "../../i18n";
import { api, errorCode, errorMessage, type AccountStatus } from "../../lib/api";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import sections from "../instance/sections.module.css";
import { SkinHead } from "../../ui/SkinHead";
import { useAppStore } from "../../store/appStore";
import styles from "./AccountCard.module.css";

/** Microsoft hesabı: giriş yapılınca oyun Launcher'a uğramadan, doğrudan dünyada açılır. */
export function AccountCard() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; calm: boolean } | null>(null);
  const t = useT();
  const setCelebrate = useAppStore((s) => s.setCelebrate);

  useEffect(() => {
    api.accountStatus().then(setStatus).catch(console.error);
  }, []);

  if (!status?.enabled) return null;
  const account = status.account;

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const a = await api.accountLogin();
      setStatus({ ...status, account: a });
      setCelebrate(a);
    } catch (e) {
      // Mojang onayı beklemek bir hata değil, bilinen bir durum: sakin renkte.
      const pending = errorCode(e) === "NOT_APPROVED";
      setError({ text: pending ? t.settings.notApproved : errorMessage(e), calm: pending });
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api.accountLogout();
    setStatus({ ...status, account: null });
  };

  return (
    <Card
      title={t.settings.account}
      description={account ? t.settings.accountOn : t.settings.accountOff}
    >
      {account ? (
        <div className={styles.row}>
          <SkinHead url={account.skin} />
          <span className={styles.name}>{account.name}</span>
          <Button size="sm" variant="ghost" icon={LogOut} onClick={logout}>
            {t.settings.logout}
          </Button>
        </div>
      ) : (
        <div className={sections.row}>
          <Button size="sm" icon={LogIn} loading={busy} onClick={login}>
            {busy ? t.settings.waitingBrowser : t.settings.login}
          </Button>
        </div>
      )}
      {error && <p className={error.calm ? sections.dim : sections.error}>{error.text}</p>}
    </Card>
  );
}
