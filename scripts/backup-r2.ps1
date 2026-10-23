# GROP 회의 영상 백업 (Windows).
# R2 버킷을 로컬 current 폴더와 같게 맞춥니다.
# R2에서 지운 파일은 current에서 빠지고, deleted\yyyy-MM-dd 로 옮겨 7일만 둡니다.
# 비밀키는 넣지 않습니다. rclone 원격 grop-r2 는 읽기 전용 토큰으로 미리 설정합니다.
# 실행 전 $BackupRoot 를 이 PC의 백업 디스크로 바꿉니다.

$ErrorActionPreference = "Stop"

$RcloneRemote = "grop-r2"
$Bucket = "grop-meeting-videos"
$BackupRoot = "D:\grop-r2-backup"
$RetentionDays = 7

$currentDir = Join-Path $BackupRoot "current"
$deletedRoot = Join-Path $BackupRoot "deleted"
$logDir = Join-Path $BackupRoot "logs"
$day = Get-Date -Format "yyyy-MM-dd"
$backupDir = Join-Path $deletedRoot $day
$logFile = Join-Path $logDir "backup-$day.log"

New-Item -ItemType Directory -Force -Path $currentDir, $backupDir, $logDir | Out-Null

function Write-Log {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $logFile -Value $line -Encoding utf8
}

Write-Log "백업 시작 remote=$RcloneRemote bucket=$Bucket"

if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
    Write-Log "rclone 이 PATH 에 없습니다. winget install Rclone.Rclone 으로 설치하세요."
    exit 1
}

# sync 는 current 를 R2와 같게 만듭니다. 지워질 파일은 오늘 deleted 폴더로 옮깁니다.
& rclone sync "${RcloneRemote}:${Bucket}" $currentDir `
    --backup-dir $backupDir `
    --log-file $logFile `
    --log-level INFO `
    --retries 3 `
    --stats 0
$rcloneExit = $LASTEXITCODE
Write-Log "rclone sync 종료 코드 $rcloneExit"

# 폴더 이름이 날짜인 것만 봅니다. 7일보다 오래된 보관본을 지워 삭제 요청이 백업에 남지 않게 합니다.
$cutoff = (Get-Date).Date.AddDays(-1 * $RetentionDays)
Get-ChildItem -LiteralPath $deletedRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $parsed = [datetime]::MinValue
    $isDate = [datetime]::TryParseExact(
        $_.Name,
        "yyyy-MM-dd",
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::None,
        [ref]$parsed
    )
    if (-not $isDate) {
        Write-Log "날짜 형식이 아니라 건너뜀: $($_.Name)"
        return
    }
    if ($parsed.Date -lt $cutoff.Date) {
        Write-Log "보관 기간이 지나 삭제: $($_.FullName)"
        Remove-Item -LiteralPath $_.FullName -Recurse -Force
    }
}

Write-Log "백업 끝"
exit $rcloneExit
