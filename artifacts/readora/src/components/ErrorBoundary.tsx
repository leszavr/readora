import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** После деплоя старые чанки пропадают с сервера, и ленивая загрузка страницы
 * падает с "Failed to fetch dynamically imported module". Единственный выход —
 * перезагрузить страницу, чтобы браузер получил свежий index.html с новыми
 * хэшами чанков. Флаг в sessionStorage защищает от цикла перезагрузок. */
const STALE_CHUNK_RELOAD_KEY = "readora:stale-chunk-reloaded";

function isStaleChunkError(error: Error): boolean {
  const message = error.message ?? "";
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("error loading dynamically imported module")
  );
}

/** Ловит ошибки рендера дерева приложения: вместо белого экрана —
 * понятная страница с деталями ошибки и кнопкой перезагрузки.
 * Ошибка логируется в консоль для диагностики по факту инцидента. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  componentDidMount(): void {
    sessionStorage.removeItem(STALE_CHUNK_RELOAD_KEY);
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isStaleChunkError(error) && !sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, "1");
      window.location.reload();
      return;
    }
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-xl font-bold">Что-то пошло не так</h1>
          <p className="text-sm text-muted-foreground">
            Произошла ошибка при отображении страницы. Попробуйте перезагрузить —
            если ошибка повторяется, сообщите нам через форму обратной связи.
          </p>
          <pre className="text-left text-xs text-muted-foreground bg-muted rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
            {this.state.error.message}
            {this.state.error.stack ? `\n${this.state.error.stack.split("\n").slice(1, 5).join("\n")}` : ""}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground h-10 px-6 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Перезагрузить страницу
          </button>
        </div>
      </div>
    );
  }
}
