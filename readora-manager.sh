#!/bin/bash

# Readora Service Manager
# Локальный менеджер разработки Readora

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/readora-manager.log"
ENV_FILE="$SCRIPT_DIR/.env"
BACKEND_PID=""
FRONTEND_PID=""

mkdir -p "$LOG_DIR"

# Cleanup function for graceful shutdown
cleanup() {
    print_log "$YELLOW" "INFO" "🛑 Получен сигнал завершения, останавливаем процессы..."
    
    if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        print_log "$CYAN" "INFO" "Остановка frontend (PID: $FRONTEND_PID)..."
        kill "$FRONTEND_PID" 2>/dev/null || true
        wait "$FRONTEND_PID" 2>/dev/null || true
    fi
    
    if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        print_log "$CYAN" "INFO" "Остановка backend (PID: $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
    
    # Force kill any remaining processes on dev ports
    stop_local_dev_processes
    
    print_log "$GREEN" "INFO" "✅ Все процессы остановлены"
    exit 0
}

# Setup signal handlers
trap cleanup SIGINT SIGTERM

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
}

print_log() {
    local color="$1"
    local level="$2"
    shift 2
    local message="$*"
    echo -e "${color}${message}${NC}"
    log "$level" "$message"
}

check_env_file() {
    if [[ ! -f "$ENV_FILE" ]]; then
        print_log "$RED" "ERROR" "❌ Файл .env не найден"
        return 1
    fi

    print_log "$GREEN" "INFO" "✅ Файл .env найден"
}

load_env_file() {
    check_env_file || return 1
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    print_log "$GREEN" "INFO" "✅ Переменные окружения загружены"
}

check_dependencies() {
    local missing_deps=()

    command -v docker >/dev/null 2>&1 || missing_deps+=("docker")
    command -v pnpm >/dev/null 2>&1 || missing_deps+=("pnpm")
    command -v lsof >/dev/null 2>&1 || missing_deps+=("lsof")

    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        print_log "$RED" "ERROR" "❌ Отсутствуют зависимости: ${missing_deps[*]}"
        return 1
    fi

    print_log "$GREEN" "INFO" "✅ Все зависимости установлены"
}

check_port() {
    local port="$1"
    timeout 2 bash -c "</dev/tcp/localhost/$port" 2>/dev/null
}

wait_for_port() {
    local port="$1"
    local label="$2"
    local max_attempts="${3:-60}"
    local delay_seconds="${4:-1}"
    local attempt=1

    print_log "$CYAN" "INFO" "⏳ Ожидание готовности $label на порту $port..."

    while [[ $attempt -le $max_attempts ]]; do
        if check_port "$port"; then
            print_log "$GREEN" "INFO" "✅ $label готов на порту $port"
            return 0
        fi

        if [[ -n "$BACKEND_PID" ]] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
            print_log "$RED" "ERROR" "❌ Процесс $label завершился до готовности порта $port"
            return 1
        fi

        echo -n "."
        sleep "$delay_seconds"
        ((attempt++))
    done

    echo ""
    print_log "$RED" "ERROR" "❌ $label не стал доступен на порту $port"
    return 1
}

stop_local_dev_processes() {
    local ports=(3000 5000)
    local pids=""
    local killed_any=false

    print_log "$BLUE" "INFO" "🧹 Останавливаем локальные dev-процессы..."

    for port in "${ports[@]}"; do
        pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
        if [[ -n "$pids" ]]; then
            print_log "$CYAN" "INFO" "Найдены процессы на порту $port: $pids"
            for pid in $pids; do
                if kill -0 "$pid" 2>/dev/null; then
                    print_log "$CYAN" "INFO" "Отправка SIGTERM процессу $pid..."
                    kill "$pid" 2>/dev/null || true
                    killed_any=true
                fi
            done
        fi
    done

    # Wait a bit for graceful shutdown
    if [[ "$killed_any" == true ]]; then
        sleep 2
    fi

    # Force kill if still running
    for port in "${ports[@]}"; do
        pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
        if [[ -n "$pids" ]]; then
            print_log "$YELLOW" "WARN" "Процессы на порту $port не остановились, отправка SIGKILL..."
            for pid in $pids; do
                kill -9 "$pid" 2>/dev/null || true
            done
            print_log "$GREEN" "INFO" "✅ Принудительно освобожден порт $port"
        else
            print_log "$GREEN" "INFO" "✅ Порт $port свободен"
        fi
    done
    
    # Also kill any pnpm processes related to dev:client or dev:server
    local pnpm_pids
    pnpm_pids=$(pgrep -f "pnpm.*dev:client|pnpm.*dev:server" || true)
    if [[ -n "$pnpm_pids" ]]; then
        print_log "$CYAN" "INFO" "Найдены pnpm dev процессы: $pnpm_pids"
        for pid in $pnpm_pids; do
            kill "$pid" 2>/dev/null || true
        done
        sleep 1
        pnpm_pids=$(pgrep -f "pnpm.*dev:client|pnpm.*dev:server" || true)
        if [[ -n "$pnpm_pids" ]]; then
            for pid in $pnpm_pids; do
                kill -9 "$pid" 2>/dev/null || true
            done
        fi
    fi
}

check_docker_services() {
    local services=("postgres")
        local running_services=()
        local stopped_services=()

    for service in "${services[@]}"; do
        if docker compose ps --services --filter status=running | grep -q "^$service$"; then
            running_services+=("$service")
        else
            stopped_services+=("$service")
        fi
    done

    if [[ ${#running_services[@]} -gt 0 ]]; then
        print_log "$GREEN" "INFO" "🟢 Запущенные сервисы: ${running_services[*]}"
    fi

    if [[ ${#stopped_services[@]} -gt 0 ]]; then
        print_log "$YELLOW" "WARN" "🔴 Остановленные сервисы: ${stopped_services[*]}"
    fi
}

start_docker_services() {
    print_log "$BLUE" "INFO" "🚀 Запуск Docker сервисов..."
    docker compose down --remove-orphans 2>/dev/null || true
        docker compose up -d postgres

    print_log "$CYAN" "INFO" "⏳ Ожидание готовности сервисов..."
    local max_attempts=30
    local attempt=1

    while [[ $attempt -le $max_attempts ]]; do
        local postgres_ready=0
        local postgres_container
        postgres_container=$(docker compose ps -q postgres 2>/dev/null || true)
        if [[ -n "$postgres_container" ]]; then
            local health_status
            health_status=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$postgres_container" 2>/dev/null || true)
            [[ "$health_status" == "healthy" ]] && postgres_ready=1 || true
        fi

        if [[ $postgres_ready -eq 1 ]]; then
            print_log "$GREEN" "INFO" "✅ Сервис PostgreSQL готов к работе"
            return 0
        fi

        echo -n "."
        sleep 2
        ((attempt++))
    done

    echo ""
    print_log "$RED" "ERROR" "❌ Сервис PostgreSQL не готов после ожидания"
    return 1
}

stop_docker_services() {
    print_log "$BLUE" "INFO" "🛑 Остановка Docker сервисов..."
    print_log "$BLUE" "INFO" "🧹 Остановка локальных dev-процессов на портах проекта..."
    stop_local_dev_processes || true
    docker compose down
    print_log "$GREEN" "INFO" "✅ Сервисы остановлены"
}

sync_database_schema() {
    print_log "$BLUE" "INFO" "🗄️  Применение миграций базы данных..."
    if pnpm run db:migrate; then
        print_log "$GREEN" "INFO" "✅ Миграции базы данных применены"
    else
        print_log "$RED" "ERROR" "❌ Ошибка применения миграций базы данных"
        return 1
    fi
}

init_storage() {
    print_log "$BLUE" "INFO" "🗄️  Инициализация хранилища..."
    if pnpm run init-storage; then
        print_log "$GREEN" "INFO" "✅ Хранилище инициализировано"
    else
        print_log "$RED" "ERROR" "❌ Ошибка инициализации хранилища"
        return 1
    fi
}

start_dev() {
    print_log "$BLUE" "INFO" "🚀 Запуск Readora в режиме разработки..."

    stop_local_dev_processes
    start_docker_services || return 1
    sync_database_schema || return 1
    # init_storage || return 1

    print_log "$GREEN" "INFO" "🌟 Запуск backend..."
    pnpm run dev:server \
        > >(sed 's/^/[backend] /') \
        2> >(sed 's/^/[backend] /' >&2) &
    BACKEND_PID=$!
    print_log "$CYAN" "INFO" "Backend запущен с PID: $BACKEND_PID"

    wait_for_port 5000 "Backend API" 60 1 || return 1

    print_log "$GREEN" "INFO" "🌐 Backend готов, запускаем frontend..."
    pnpm run dev:client \
        > >(sed 's/^/[frontend] /') \
        2> >(sed 's/^/[frontend] /' >&2) &
    FRONTEND_PID=$!
    print_log "$CYAN" "INFO" "Frontend запущен с PID: $FRONTEND_PID"
    
    print_log "$GREEN" "INFO" "✅ Приложение запущено. Нажмите Ctrl+C для остановки."
    
    # Wait for both processes
    wait "$FRONTEND_PID" "$BACKEND_PID" 2>/dev/null || true
}

build_project() {
    print_log "$BLUE" "INFO" "🔨 Сборка проекта..."
    pnpm run build
    print_log "$GREEN" "INFO" "✅ Проект собран успешно"
}

check_types() {
    print_log "$BLUE" "INFO" "🔍 Проверка типов TypeScript..."
    pnpm run check
    print_log "$GREEN" "INFO" "✅ Типы корректны"
}

show_status() {
    echo -e "${CYAN}=== Readora Service Status ===${NC}"
    echo ""
    check_docker_services
    echo ""
    echo -e "${CYAN}Статус приложений:${NC}"
    if check_port 5000; then
        echo -e "  🟢 Backend API: ${GREEN}Запущен${NC} (http://localhost:5000)"
    else
        echo -e "  🔴 Backend API: ${RED}Остановлен${NC} (http://localhost:5000)"
    fi

    if check_port 3000; then
        echo -e "  🟢 Frontend: ${GREEN}Запущен${NC} (http://localhost:3000)"
    else
        echo -e "  🔴 Frontend: ${RED}Остановлен${NC} (http://localhost:3000)"
    fi

    echo ""
    echo -e "${CYAN}Docker Compose Services:${NC}"
    docker compose ps
    echo ""
    echo -e "${CYAN}Порты:${NC}"
    echo -e "  🌐 Frontend: http://localhost:3000"
    echo -e "  🔧 Backend API: http://localhost:5000"
    echo -e "  🗄️  PostgreSQL: localhost:5432"
        # echo -e "  📦 MinIO API: http://localhost:9000"
        # echo -e "  📦 MinIO Console: http://localhost:9001"
}

show_logs() {
    if [[ -f "$LOG_FILE" ]]; then
        tail -f "$LOG_FILE"
    else
        print_log "$YELLOW" "WARN" "⚠️ Лог-файл пока не создан"
    fi
}

clean_logs() {
    rm -f "$LOG_FILE"
    print_log "$GREEN" "INFO" "✅ Логи очищены"
}

show_help() {
    cat <<'EOF'
Readora Service Manager

Использование:
  ./readora-manager.sh <command>

Команды:
  start       Запуск приложения в режиме разработки
  stop        Остановка Docker-сервисов и локальных dev-процессов
  restart     Перезапуск приложения
  status      Показать статус сервисов
  services    Поднять только PostgreSQL
  db          Синхронизировать схему базы данных
    storage     Инициализировать MinIO bucket (закомментировано)
  build       Собрать проект
  check       Проверить TypeScript
  logs        Показать лог manager script
  clean       Очистить лог manager script
  help        Показать эту справку
EOF
}

main() {
    local command="${1:-start}"

    case "$command" in
        start)
            check_dependencies
            load_env_file
            start_dev
            ;;
        stop)
            stop_docker_services
            ;;
        restart)
            stop_docker_services
            check_dependencies
            load_env_file
            start_dev
            ;;
        status)
            show_status
            ;;
        services)
            check_dependencies
            load_env_file
            start_docker_services
            ;;
        db)
            check_dependencies
            load_env_file
            sync_database_schema
            ;;
        storage)
            check_dependencies
            load_env_file
            init_storage
            ;;
        build)
            check_dependencies
            build_project
            ;;
        check)
            check_dependencies
            check_types
            ;;
        logs)
            show_logs
            ;;
        clean)
            clean_logs
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            print_log "$RED" "ERROR" "❌ Неизвестная команда: $command"
            show_help
            return 1
            ;;
    esac
}

main "$@"
