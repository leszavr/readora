#!/usr/bin/env bash

set -Eeuo pipefail

readonly LOCK_FILE="/run/lock/readora-docker-cleanup.lock"
readonly RETENTION_HOURS="${RETENTION_HOURS:-72}"
readonly MAX_BUILD_CACHE="${MAX_BUILD_CACHE:-2GB}"

log() {
  printf '%s [readora-docker-cleanup] %s\n' "$(date --iso-8601=seconds)" "$*"
}

remove_expired_unreferenced_images() {
  local cutoff_epoch image_id created_at created_epoch
  local referenced_images_file
  local -a image_ids

  cutoff_epoch="$(date --date="${RETENTION_HOURS} hours ago" +%s)"
  referenced_images_file="$(mktemp)"
  docker ps --all --quiet | xargs -r docker inspect --format '{{.Image}}' > "$referenced_images_file"
  mapfile -t image_ids < <(docker image ls --quiet --no-trunc | sort -u)

  for image_id in "${image_ids[@]}"; do
    if grep --fixed-strings --quiet --line-regexp -- "$image_id" "$referenced_images_file"; then
      continue
    fi

    created_at="$(docker image inspect --format '{{.Created}}' "$image_id" 2>/dev/null)" || continue
    created_epoch="$(date --date="$created_at" +%s)" || {
      log "Skipping image ${image_id}: could not determine creation time."
      continue
    }

    if (( created_epoch >= cutoff_epoch )); then
      continue
    fi

    log "Removing unreferenced image ${image_id}."
    if ! docker image rm "$image_id"; then
      log "Keeping image ${image_id}: it became referenced or has dependent images."
    fi
  done

  rm -f "$referenced_images_file"
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "A cleanup is already running; skipping this run."
  exit 0
fi

log "Starting cleanup: retention=${RETENTION_HOURS}h, maxBuildCache=${MAX_BUILD_CACHE}."
log "Disk usage before cleanup:"
df -h /

log "Docker usage before cleanup:"
docker system df

log "Pruning stopped containers older than ${RETENTION_HOURS}h."
docker container prune --force --filter "until=${RETENTION_HOURS}h"

log "Removing unreferenced images older than ${RETENTION_HOURS}h."
remove_expired_unreferenced_images

log "Pruning build cache down to ${MAX_BUILD_CACHE}."
docker buildx prune --all --force --max-used-space "${MAX_BUILD_CACHE}"

log "Disk usage after cleanup:"
df -h /

log "Docker usage after cleanup:"
docker system df

log "Cleanup completed. Volumes and networks were not pruned."
