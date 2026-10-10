import { Plus, Server } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/Card";

export function EmptyScreen() {
  const hasInstances = useAppStore((s) => s.instances.length > 0);
  const navigate = useAppStore((s) => s.navigate);

  return hasInstances ? (
    <EmptyState icon={Server} title="Bir sunucu seç" description="Soldaki listeden bir sunucu seç ya da yenisini kur." />
  ) : (
    <EmptyState
      icon={Server}
      title="İlk sunucunu kur"
      description="Birkaç adımda bir Minecraft sunucusu kurup kardeşinle oynamaya başla. Gerekli her şeyi uygulama indirir."
      action={
        <Button variant="primary" size="lg" icon={Plus} onClick={() => navigate({ name: "wizard" })}>
          Yeni sunucu
        </Button>
      }
    />
  );
}
