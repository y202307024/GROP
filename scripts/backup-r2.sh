#!/bin/sh
# GROP 회의 영상 백업 (Mac, Linux).
# R2 버킷을 로컬 current 폴더와 같게 맞춥니다.
# R2에서 지운 파일은 current에서 빠지고, deleted/yyyy-MM-dd 로 옮겨 7일만 둡니다.
# 비밀키는 넣지 않습니다. rclone 원격 grop-r2 는 읽기 전용 토큰으로 미리 설정합니다.
# 실행 전 BACKUP_ROOT 를 이 PC의 백업 디스크로 바꾸고, chmod +x 로 실행 권한을 줍니다.

RCLONE_REMOTE="grop-r2"
BUCKET="grop-meeting-videos"
BACKUP_ROOT="/var/backups/grop-r2"
RETENTION_DAYS=7

CURRENT_DIR="${BACKUP_ROOT}/current"
DELETED_ROOT="${BACKUP_ROOT}/deleted"
LOG_DIR="${BACKUP_ROOT}/logs"
DAY=$(date +%Y-%m-%d)
BACKUP_DIR="${DELETED_ROOT}/${DAY}"
LOG_FILE="${LOG_DIR}/backup-${DAY}.log"

mkdir -p "$CURRENT_DIR" "$BACKUP_DIR" "$LOG_DIR"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "$LOG_FILE"
}

log "백업 시작 remote=${RCLONE_REMOTE} bucket=${BUCKET}"

if ! command -v rclone >/dev/null 2>&1; then
  log "rclone 이 PATH 에 없습니다."
  exit 1
fi

# sync 는 current 를 R2와 같게 만듭니다. 지워질 파일은 오늘 deleted 폴더로 옮깁니다.
rclone sync "${RCLONE_REMOTE}:${BUCKET}" "$CURRENT_DIR" \
  --backup-dir "$BACKUP_DIR" \
  --log-file "$LOG_FILE" \
  --log-level INFO \
  --retries 3 \
  --stats 0
rclone_exit=$?
log "rclone sync 종료 코드 ${rclone_exit}"

# 폴더 이름이 날짜인 것만 지웁니다. 기준일보다 앞선 보관본만 지우고, 기준일 당일은 남깁니다.
# GNU date 가 없으면 Mac date 를 씁니다. 둘 다 실패하면 보관본은 건드리지 않습니다.
cutoff=$(date -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -v-"${RETENTION_DAYS}"d +%Y-%m-%d 2>/dev/null || true)
if [ -z "$cutoff" ]; then
  log "보관 기준 날짜를 계산하지 못했습니다. deleted 폴더는 그대로 둡니다."
else
  for dir in "$DELETED_ROOT"/*; do
    [ -d "$dir" ] || continue
    name=$(basename "$dir")
    case "$name" in
      [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
      *)
        log "날짜 형식이 아니라 건너뜀: ${name}"
        continue
        ;;
    esac
    # yyyy-MM-dd 는 문자열 순서가 날짜 순서와 같습니다.
    first=$(printf '%s\n%s\n' "$name" "$cutoff" | sort | head -n 1)
    if [ "$first" = "$name" ] && [ "$name" != "$cutoff" ]; then
      log "보관 기간이 지나 삭제: ${dir}"
      rm -rf "$dir"
    fi
  done
fi

log "백업 끝"
exit "$rclone_exit"
