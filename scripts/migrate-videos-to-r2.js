/**
 * 서버 디스크에 남아 있는 예전 회의 영상을 Cloudflare R2로 옮깁니다.
 * 이 스크립트는 서버 PC에서만 실행합니다.
 * Supabase 서비스 롤 키는 RLS를 건너뛰므로 .env 밖으로 꺼내지 말고, 브라우저나 배포 환경 변수에 넣지 않습니다.
 *
 * 사용법 (저장소 루트):
 *   node scripts/migrate-videos-to-r2.js --dry-run
 *   node scripts/migrate-videos-to-r2.js
 *
 * --dry-run 은 R2에 올리거나 meetings 를 바꾸지 않고, 옮길 파일과 맞출 회의만 출력합니다.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const videosDir = path.resolve(repoRoot, 'server', 'uploads', 'meeting-videos')
const serverRequire = createRequire(path.join(repoRoot, 'server', 'package.json'))

const dotenv = serverRequire('dotenv')
const { S3Client, PutObjectCommand, HeadObjectCommand } = serverRequire('@aws-sdk/client-s3')

dotenv.config({ path: path.join(repoRoot, '.env') })

const dryRun = process.argv.includes('--dry-run')
const unknownArg = process.argv.slice(2).find((arg) => arg !== '--dry-run')
if (unknownArg) {
  console.error(`알 수 없는 인자입니다: ${unknownArg}`)
  console.error('사용법: node scripts/migrate-videos-to-r2.js [--dry-run]')
  process.exit(1)
}

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} 가 .env 에 없습니다.`)
  }
  return value
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mkv') return 'video/x-matroska'
  return 'application/octet-stream'
}

/** DB의 video_url 에서 디스크 상대 경로(groupId/날짜/파일)만 뽑습니다. */
function relativeFromVideoUrl(videoUrl) {
  let rel = String(videoUrl || '').trim()
  if (!rel) return null

  const videosMarker = '/videos/'
  const videosIdx = rel.indexOf(videosMarker)
  if (videosIdx >= 0) {
    rel = rel.slice(videosIdx + videosMarker.length)
  } else {
    const marker = '/meeting-videos/'
    const idx = rel.indexOf(marker)
    if (idx >= 0) rel = rel.slice(idx + marker.length)
  }

  rel = rel.split('?')[0] ?? ''
  try {
    rel = decodeURIComponent(rel)
  } catch {
    return null
  }
  rel = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (rel.endsWith('.url.txt')) rel = rel.slice(0, -'.url.txt'.length)
  if (!rel || rel.split('/').some((part) => part === '' || part === '.' || part === '..')) return null
  return rel
}

function walkVideos(dir, found) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // 업로드가 끝나기 전 임시 파일은 회의 영상이 아닙니다.
    if (entry.name === '_incoming') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkVideos(full, found)
      continue
    }
    if (!entry.isFile()) continue
    const rel = path.relative(videosDir, full).split(path.sep).join('/')
    if (!rel || rel.split('/').some((part) => part === '..')) continue
    found.push({ full, rel, size: fs.statSync(full).size })
  }
}

async function loadMeetings(supabase) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('meetings')
      .select('id, video_url, video_key, video_size_bytes')
      .not('video_url', 'is', null)
      .range(from, from + pageSize - 1)
    if (error) {
      if (/video_key|video_size_bytes/i.test(error.message)) {
        throw new Error(`${error.message}\nsupabase/08_영상_R2_상태.sql 을 먼저 적용하세요.`)
      }
      throw new Error(error.message)
    }
    if (!data?.length) break
    rows.push(...data)
    if (data.length < pageSize) break
  }
  return rows
}

function indexMeetings(rows) {
  const byPath = new Map()
  const byName = new Map()
  for (const row of rows) {
    const rel = relativeFromVideoUrl(row.video_url)
    if (!rel) continue
    const pathRows = byPath.get(rel) ?? []
    pathRows.push(row)
    byPath.set(rel, pathRows)
    const base = rel.split('/').pop()
    const nameRows = byName.get(base) ?? []
    nameRows.push(row)
    byName.set(base, nameRows)
  }
  return { byPath, byName }
}

/**
 * 디스크 경로가 같으면 그 회의를 쓰고, 없으면 파일 이름이 하나일 때만 맞춥니다.
 * 같은 이름이 여러 회의면 어느 쪽인지 알 수 없어 기록은 건너뜁니다.
 */
function matchMeetings(file, index) {
  const pathRows = index.byPath.get(file.rel) ?? []
  if (pathRows.length > 0) return { rows: pathRows, how: '경로 일치' }
  const base = file.rel.split('/').pop()
  const nameRows = index.byName.get(base) ?? []
  if (nameRows.length === 1) return { rows: nameRows, how: '파일 이름 일치' }
  if (nameRows.length > 1) return { rows: [], how: '같은 파일 이름의 회의가 여러 개라 기록은 건너뜀' }
  return { rows: [], how: '연결된 회의 없음' }
}

async function objectHasSameSize(client, bucket, key, size) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return Number(head.ContentLength) === size
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode
    if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') return false
    throw err
  }
}

async function main() {
  const accountId = requireEnv('R2_ACCOUNT_ID')
  const bucket = requireEnv('R2_BUCKET')
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || requireEnv('VITE_SUPABASE_URL')
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  })
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const files = []
  walkVideos(videosDir, files)
  const meetings = await loadMeetings(supabase)
  const index = indexMeetings(meetings)

  console.log(dryRun ? 'dry-run: 변경하지 않습니다.' : '이전을 시작합니다.')
  console.log(`디스크: ${videosDir}`)
  console.log(`파일 ${files.length}개, video_url 이 있는 회의 ${meetings.length}개`)

  let uploaded = 0
  let alreadyThere = 0
  let updated = 0
  let skippedRows = 0
  let unmatched = 0

  for (const file of files) {
    const key = `meeting-videos/${file.rel}`
    const { rows, how } = matchMeetings(file, index)
    console.log(`${dryRun ? '[dry-run] ' : ''}${file.rel} (${file.size} bytes) -> ${key} / ${how}`)

    if (!dryRun) {
      const same = await objectHasSameSize(client, bucket, key, file.size)
      if (same) {
        alreadyThere += 1
        console.log('  R2에 같은 크기 객체가 있어 업로드는 건너뜁니다.')
      } else {
        await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: fs.createReadStream(file.full),
          ContentLength: file.size,
          ContentType: contentTypeFor(file.full),
        }))
        uploaded += 1
        console.log('  R2 업로드 완료')
      }
    }

    if (rows.length === 0) {
      unmatched += 1
      continue
    }

    for (const row of rows) {
      if (row.video_key && row.video_key !== key) {
        skippedRows += 1
        console.log(`  회의 ${row.id} 는 다른 video_key 가 있어 그대로 둡니다.`)
        continue
      }
      if (row.video_key === key && Number(row.video_size_bytes) === file.size) {
        console.log(`  회의 ${row.id} 는 이미 같은 키와 크기입니다.`)
        continue
      }
      if (dryRun) {
        console.log(`  회의 ${row.id} 에 video_key, video_status=uploaded, video_size_bytes=${file.size} 를 넣을 예정입니다.`)
        continue
      }
      const { error } = await supabase
        .from('meetings')
        .update({
          video_key: key,
          video_status: 'uploaded',
          video_size_bytes: file.size,
        })
        .eq('id', row.id)
      if (error) throw new Error(`회의 ${row.id} 갱신 실패: ${error.message}`)
      updated += 1
      console.log(`  회의 ${row.id} 갱신`)
    }
  }

  console.log('---')
  console.log(
    dryRun
      ? `확인만 했습니다. 파일 ${files.length}개, 회의 기록 없음 ${unmatched}개.`
      : `업로드 ${uploaded}개, 이미 있음 ${alreadyThere}개, 회의 갱신 ${updated}개, 다른 키라 유지 ${skippedRows}개, 회의 기록 없음 ${unmatched}개.`,
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
