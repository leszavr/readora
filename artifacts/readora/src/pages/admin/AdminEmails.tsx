import { useState } from "react";
import {
  useGetSavedEmails,
  useGetSavedEmail,
  useDeleteSavedEmail,
  useClearSavedEmails,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Mail, Trash2, Eye, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function AdminEmails() {
  const qc = useQueryClient();
  const { data: emails, isLoading } = useGetSavedEmails();
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [showClearDialog, setShowClearDialog] = useState(false);

  const { data: selectedEmail } = useGetSavedEmail(selectedEmailId ?? "");

  const { mutate: deleteEmail } = useDeleteSavedEmail({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getSavedEmails"] });
        setSelectedEmailId(null);
      },
    },
  });

  const { mutate: clearAll, isPending: isClearing } = useClearSavedEmails({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ["getSavedEmails"] });
        setShowClearDialog(false);
      },
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Сохранённые письма</CardTitle>
              <CardDescription>
                Письма сохранённые локально вместо отправки через SMTP
              </CardDescription>
            </div>
            {emails && emails.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowClearDialog(true)}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Очистить все
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!emails || emails.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Нет сохранённых писем</p>
              <p className="text-sm mt-1">
                Включите "Сохранять письма в файлы" в настройках SMTP
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {emails.map((email) => (
                <div
                  key={email.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{email.subject}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      Кому: {email.to}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(email.date).toLocaleString("ru-RU")}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedEmailId(email.id)}
                      className="gap-2"
                    >
                      <Eye className="w-4 h-4" />
                      Просмотр
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteEmail({ id: email.id })}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog для просмотра письма */}
      <Dialog open={!!selectedEmailId} onOpenChange={() => setSelectedEmailId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Просмотр письма</DialogTitle>
            <DialogDescription>
              {selectedEmail?.subject}
            </DialogDescription>
          </DialogHeader>
          {selectedEmail && (
            <div className="flex-1 overflow-y-auto space-y-4">
              <div className="space-y-2 text-sm">
                <div>
                  <span className="font-medium">От:</span> {selectedEmail.from}
                </div>
                <div>
                  <span className="font-medium">Кому:</span>{" "}
                  {Array.isArray(selectedEmail.to)
                    ? selectedEmail.to.join(", ")
                    : selectedEmail.to}
                </div>
                <div>
                  <span className="font-medium">Дата:</span>{" "}
                  {new Date(selectedEmail.date).toLocaleString("ru-RU")}
                </div>
              </div>
              <div className="border-t pt-4">
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <div dangerouslySetInnerHTML={{ __html: selectedEmail.html }} />
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog для подтверждения очистки */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Очистить все письма?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить. Все сохранённые письма будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => clearAll()}
              disabled={isClearing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isClearing && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Очистить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
