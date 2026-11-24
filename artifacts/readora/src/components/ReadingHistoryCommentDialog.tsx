import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListReadingHistoryQueryKey,
  useUpdateReadingHistoryComment,
  type ReadingHistoryEntry,
} from "@workspace/api-client-react";
import { Pencil, Trash2 } from "lucide-react";
import { NoteEditor, NoteText } from "@/components/NoteEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { HISTORY_COMMENT_MAX_LENGTH } from "@/lib/reading-history";

interface Props {
  entry: ReadingHistoryEntry | null;
  onOpenChange: (open: boolean) => void;
}

function CommentDialogBody({ entry, onDone }: Readonly<{ entry: ReadingHistoryEntry; onDone: () => void }>) {
  const hasComment = Boolean(entry.comment);
  const [editing, setEditing] = useState(!hasComment);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateComment = useUpdateReadingHistoryComment();

  const refreshList = () => {
    void queryClient.invalidateQueries({ queryKey: getListReadingHistoryQueryKey() });
  };

  const save = (text: string) => {
    updateComment.mutate(
      { id: entry.id, data: { comment: text } },
      {
        onSuccess: () => {
          refreshList();
          toast({ title: "Комментарий сохранён" });
          onDone();
        },
        onError: () => {
          toast({ title: "Не удалось сохранить комментарий", variant: "destructive" });
        },
      },
    );
  };

  const remove = () => {
    updateComment.mutate(
      { id: entry.id, data: { comment: null } },
      {
        onSuccess: () => {
          refreshList();
          toast({ title: "Комментарий удалён" });
          onDone();
        },
        onError: () => {
          toast({ title: "Не удалось удалить комментарий", variant: "destructive" });
        },
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="pr-6">{entry.title}</DialogTitle>
        <DialogDescription className="truncate">{entry.author ?? "Автор не указан"}</DialogDescription>
      </DialogHeader>

      {editing ? (
        <NoteEditor
          initialText={entry.comment ?? ""}
          maxLength={HISTORY_COMMENT_MAX_LENGTH}
          placeholder="Ваше впечатление о книге…"
          showColor={false}
          showCounter
          autoFocus
          onSave={(text) => save(text)}
          onCancel={() => (hasComment ? setEditing(false) : onDone())}
        />
      ) : (
        <>
          <div className="max-h-[50vh] overflow-y-auto rounded-md border bg-muted/40 p-3">
            <NoteText text={entry.comment ?? ""} className="text-sm" />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" className="gap-2 text-destructive hover:text-destructive" onClick={remove} disabled={updateComment.isPending}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Удалить комментарий
            </Button>
            <Button type="button" className="gap-2" onClick={() => setEditing(true)} disabled={updateComment.isPending}>
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Редактировать
            </Button>
          </DialogFooter>
        </>
      )}
    </>
  );
}

export function ReadingHistoryCommentDialog({ entry, onOpenChange }: Readonly<Props>) {
  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {entry && <CommentDialogBody key={entry.id} entry={entry} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
