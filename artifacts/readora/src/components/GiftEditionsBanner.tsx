import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAvailableGiftEditionsQueryKey,
  getGetStorageQuotaQueryKey,
  getListBooksQueryKey,
  useClaimGiftEditions,
  useGetAvailableGiftEditions,
} from "@workspace/api-client-react";
import { Gift, Landmark, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocalStorageState } from "@/hooks/use-local-storage-state";
import { useToast } from "@/hooks/use-toast";

const ONBOARDING_KEY = "readora.giftEditions.onboardingSeen";
const DISMISSED_COUNT_KEY = "readora.giftEditions.dismissedCount";

export function GiftEditionsBanner({ hasGiftBooks }: Readonly<{ hasGiftBooks: boolean }>) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [onboardingSeen, setOnboardingSeen] = useLocalStorageState(ONBOARDING_KEY, false);
  const [dismissedCount, setDismissedCount] = useLocalStorageState<number | null>(DISMISSED_COUNT_KEY, null);
  const { data } = useGetAvailableGiftEditions();
  const claimMutation = useClaimGiftEditions();
  const availableCount = data?.availableCount ?? 0;

  async function claim() {
    try {
      const { added } = await claimMutation.mutateAsync();
      setOnboardingSeen(true);
      void queryClient.invalidateQueries({ queryKey: getListBooksQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetAvailableGiftEditionsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetStorageQuotaQueryKey() });
      toast({ title: added > 0 ? `Добавлено книг: ${added}` : "Все подарочные издания уже в библиотеке" });
    } catch {
      toast({ title: "Не удалось добавить книги", description: "Повторите попытку позже.", variant: "destructive" });
    }
  }

  if (availableCount > 0 && dismissedCount !== availableCount) {
    return (
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center">
        <Landmark className="hidden h-6 w-6 shrink-0 text-primary sm:block" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Подарок для новых читателей: {availableCount} книг мировой классики</p>
          <p className="text-muted-foreground">Это произведения из категории «Мировое достояние» — классика, которую можете читать уже сейчас. Добавьте их одним нажатием: они не занимают места в вашей библиотеке.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" className="gap-2" onClick={claim} disabled={claimMutation.isPending}>
            {claimMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
            Получить книги
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setDismissedCount(availableCount)} aria-label="Скрыть">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  if (hasGiftBooks && !onboardingSeen) {
    return (
      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center">
        <Gift className="hidden h-6 w-6 shrink-0 text-primary sm:block" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Мы добавили в вашу библиотеку книги из категории «Мировое достояние»</p>
          <p className="text-muted-foreground">
            Начните читать прямо сейчас. Описание и обложку можно изменить, а книгу — удалить, как любую свою. Место в квоте они не занимают.
          </p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOnboardingSeen(true)}>
          Понятно
        </Button>
      </div>
    );
  }

  return null;
}
