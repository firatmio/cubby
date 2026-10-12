import { useRef, useState, type ReactNode } from "react";
import { api, errorMessage, openExternal, type Instance } from "../../lib/api";
import { useT } from "../../i18n";
import { useAppStore, useServer } from "../../store/appStore";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { JavaDownloadProgress } from "../instance/JavaDownloadProgress";

const EULA_URL = "https://aka.ms/MinecraftEULA";

/**
 * Başlat/Durdur akışı: EULA onayı → uygun Java yoksa indirme önerisi → başlatma.
 * Diyalogları ve hata mesajını da döner; çağıran yerleştirir.
 */
export function useServerControl(instance: Instance) {
  const id = instance.id;
  const { status } = useServer(id);
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [eulaOpen, setEulaOpen] = useState(false);
  const [javaPrompt, setJavaPrompt] = useState<number | null>(null);
  const [javaInstalling, setJavaInstalling] = useState(false);
  /** EULA/Java diyaloğundan sonra yeniden başlatılırken "katıl" seçimi korunsun. */
  const joinRef = useRef(false);

  const start = async (join = joinRef.current) => {
    joinRef.current = join;
    setError(null);
    useAppStore.getState().setLaunchResult(id, null);
    setStarting(true);
    try {
      if (!(await api.eulaStatus(id))) {
        setEulaOpen(true);
        return;
      }
      const java = await api.instanceJava(id);
      if (java.error) {
        setError(t.start.javaError(java.error));
        return;
      }
      if (!java.selected) {
        setJavaPrompt(java.required);
        return;
      }
      await api.startServer(id, join);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await api.stopServer(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const acceptEula = async () => {
    setEulaOpen(false);
    try {
      await api.acceptEula(id);
      await start();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const installJavaAndStart = async (major: number) => {
    setJavaInstalling(true);
    useAppStore.getState().setJavaProgress(null);
    try {
      await api.installJava(major);
      setJavaPrompt(null);
      await start();
    } catch (e) {
      setJavaPrompt(null);
      setError(errorMessage(e));
    } finally {
      setJavaInstalling(false);
    }
  };

  const active = status === "starting" || status === "running" || status === "stopping";

  const dialogs: ReactNode = (
    <>
      {javaPrompt !== null && (
        <Dialog
          title={t.start.javaTitle}
          actions={
            javaInstalling ? undefined : (
              <>
                <Button variant="ghost" onClick={() => setJavaPrompt(null)}>
                  {t.common.cancel}
                </Button>
                <Button variant="primary" onClick={() => installJavaAndStart(javaPrompt)}>
                  {t.start.javaDownloadStart}
                </Button>
              </>
            )
          }
        >
          {javaInstalling ? (
            <JavaDownloadProgress />
          ) : (
            <>
              <p>{t.start.javaMissing(javaPrompt)}</p>
              <p>{t.start.javaOffer}</p>
            </>
          )}
        </Dialog>
      )}

      {eulaOpen && (
        <Dialog
          title="Minecraft EULA"
          actions={
            <>
              <Button variant="ghost" onClick={() => setEulaOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button variant="primary" onClick={acceptEula}>
                {t.start.eulaAccept}
              </Button>
            </>
          }
        >
          <p>{t.start.eulaText}</p>
          <p>
            <a
              href={EULA_URL}
              onClick={(e) => {
                e.preventDefault();
                openExternal(EULA_URL);
              }}
            >
              {t.start.eulaRead}
            </a>
          </p>
        </Dialog>
      )}
    </>
  );

  return { status, active, starting, start, stop, error, clearError: () => setError(null), dialogs };
}
