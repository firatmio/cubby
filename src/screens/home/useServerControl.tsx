import { useState, type ReactNode } from "react";
import { api, errorMessage, openExternal, type Instance } from "../../lib/api";
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
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [eulaOpen, setEulaOpen] = useState(false);
  const [javaPrompt, setJavaPrompt] = useState<number | null>(null);
  const [javaInstalling, setJavaInstalling] = useState(false);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      if (!(await api.eulaStatus(id))) {
        setEulaOpen(true);
        return;
      }
      const java = await api.instanceJava(id);
      if (java.error) {
        setError(`${java.error} Gelişmiş > Java'dan değiştirebilirsin.`);
        return;
      }
      if (!java.selected) {
        setJavaPrompt(java.required);
        return;
      }
      await api.startServer(id);
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
          title="Java gerekli"
          actions={
            javaInstalling ? undefined : (
              <>
                <Button variant="ghost" onClick={() => setJavaPrompt(null)}>
                  Vazgeç
                </Button>
                <Button variant="primary" onClick={() => installJavaAndStart(javaPrompt)}>
                  İndir ve başlat
                </Button>
              </>
            )
          }
        >
          {javaInstalling ? (
            <JavaDownloadProgress />
          ) : (
            <>
              <p>Bu dünya Java {javaPrompt} istiyor ama bilgisayarında uygun bir Java bulunamadı.</p>
              <p>
                Açık kaynak Eclipse Temurin'i (yaklaşık 50 MB) uygulamanın kendi klasörüne indirebilirim. Sistemine
                kurulmaz, başka programları etkilemez.
              </p>
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
                Vazgeç
              </Button>
              <Button variant="primary" onClick={acceptEula}>
                Kabul ediyorum
              </Button>
            </>
          }
        >
          <p>
            Sunucu açmak için Mojang'ın Son Kullanıcı Lisans Sözleşmesi'ni (EULA) kabul etmen gerekiyor. Bu dünya için
            yalnızca bir kez soracağım.
          </p>
          <p>
            <a
              href={EULA_URL}
              onClick={(e) => {
                e.preventDefault();
                openExternal(EULA_URL);
              }}
            >
              EULA'yı oku
            </a>
          </p>
        </Dialog>
      )}
    </>
  );

  return { status, active, starting, start, stop, error, clearError: () => setError(null), dialogs };
}
