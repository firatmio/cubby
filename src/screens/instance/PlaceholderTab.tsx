import type { LucideIcon } from "lucide-react";
import { Badge } from "../../ui/Badge";
import { EmptyState } from "../../ui/Card";

export function PlaceholderTab({ icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <EmptyState
      icon={icon}
      title="Yakında"
      description={text}
      action={<Badge tone="neutral">Sonraki sürümde</Badge>}
    />
  );
}
