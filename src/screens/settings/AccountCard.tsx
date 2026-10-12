import { useEffect, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { api, errorMessage, type AccountStatus } from "../../lib/api";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import sections from "../instance/sections.module.css";
import styles from "./AccountCard.module.css";

/** Skin'in yüz kısmı (8×8) ve şapka katmanı; skin 64×64 PNG. */
function SkinHead({ url }: { url: string | null }) {
  // textures.minecraft.net http adres veriyor; uygulama sayfası https olduğu için https'e çevrilir.
  const src = url?.replace(/^http:\/\//, "https://");
  return (
    <span className={styles.head} aria-hidden>
      {src && (
        <>
          <span className={styles.face} style={{ backgroundImage: `url("${src}")` }} />
          <span className={styles.hat} style={{ backgroundImage: `url("${src}")` }} />
        </>
      )}
    </span>
  );
}

/** Microsoft hesabı: giriş yapılınca oyun Launcher'a uğramadan, doğrudan dünyada açılır. */
export function AccountCard() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      setError(errorMessage(e));
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
      title="Microsoft hesabı"
      description={
        account
          ? "\"Başlat ve katıl\" ve arkadaşının dünyasında \"Oyna\", oyunu Launcher'a uğramadan doğrudan dünyada açar."
          : "Giriş yaparsan oyun Launcher'a uğramadan, tek tıkla doğrudan dünyada açılır. Giriş Microsoft'un kendi sayfasında olur; şifren uygulamaya gelmez."
      }
    >
      {account ? (
        <div className={styles.row}>
          <SkinHead url={account.skin} />
          <span className={styles.name}>{account.name}</span>
          <Button size="sm" variant="ghost" icon={LogOut} onClick={logout}>
            Çıkış yap
          </Button>
        </div>
      ) : (
        <div className={sections.row}>
          <Button size="sm" icon={LogIn} loading={busy} onClick={login}>
            {busy ? "Tarayıcıda giriş bekleniyor…" : "Microsoft ile giriş yap"}
          </Button>
        </div>
      )}
      {error && <p className={sections.error}>{error}</p>}
    </Card>
  );
}
