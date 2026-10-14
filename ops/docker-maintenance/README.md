# Обслуживание Docker-хоста Readora

Эти файлы устанавливаются на production-хост с Docker и systemd. Они не являются частью образа приложения и не применяются через обычный CapRover-деплой.

## Политика очистки

- остановленные контейнеры удаляются через 72 часа;
- удаляются только образы старше 72 часов, на которые не ссылается ни один контейнер;
- build cache ограничен 2 ГБ;
- Docker volumes и сети не удаляются.

Очистка запускается ежедневно в 18:30 UTC (04:30 по Владивостоку), с дополнительной случайной задержкой до 15 минут. `flock` не допускает одновременных запусков.

## Установка на хост

```bash
install -m 0755 readora-docker-cleanup.sh /usr/local/sbin/readora-docker-cleanup
install -m 0644 readora-docker-cleanup.service /etc/systemd/system/readora-docker-cleanup.service
install -m 0644 readora-docker-cleanup.timer /etc/systemd/system/readora-docker-cleanup.timer
systemctl daemon-reload
systemctl enable --now readora-docker-cleanup.timer
systemctl start readora-docker-cleanup.service
```

## Проверка

```bash
systemctl status readora-docker-cleanup.timer
systemctl list-timers readora-docker-cleanup.timer
journalctl -u readora-docker-cleanup.service -n 100 --no-pager
```

## Ручной запуск

```bash
systemctl start readora-docker-cleanup.service
```

Не добавляйте к этому сервису `docker volume prune`, `docker system prune --volumes` или `docker compose down -v`: эти команды могут удалить PostgreSQL или загруженные книги.
