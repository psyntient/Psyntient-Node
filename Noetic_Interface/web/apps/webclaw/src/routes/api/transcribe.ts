import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

// Seven levels up from routes/api/ is the Psyntient_Node root, same as
// vault.ts / provider-key.ts.
const NODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..', '..', '..')
const CONTROL_SCRIPT = path.join(NODE_ROOT, 'daemon', 'voice-transcription-control.mjs')
const TRANSCRIBE_URL = 'http://127.0.0.1:18790/transcribe'

function extensionForContentType(contentType: string): string {
  if (contentType.includes('mp4')) return 'mp4'
  if (contentType.includes('ogg')) return 'ogg'
  if (contentType.includes('wav')) return 'wav'
  return 'webm'
}

function ensureWorkerRunning(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CONTROL_SCRIPT, 'ensure-running'], { cwd: NODE_ROOT })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `voice-transcription-control exited with code ${code}`))
        return
      }
      resolve()
    })
  })
}

function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', outputPath])
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
        return
      }
      resolve()
    })
  })
}

export const Route = createFileRoute('/api/transcribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const id = randomUUID()
        const contentType = request.headers.get('content-type') || 'audio/webm'
        const inputPath = path.join(os.tmpdir(), `psyntient-voice-${id}.${extensionForContentType(contentType)}`)
        const wavPath = path.join(os.tmpdir(), `psyntient-voice-${id}.wav`)

        try {
          const buffer = Buffer.from(await request.arrayBuffer())
          if (buffer.length === 0) {
            return json({ ok: false, error: 'No audio received' }, { status: 400 })
          }
          await fs.writeFile(inputPath, buffer)
          await convertToWav(inputPath, wavPath)
          await ensureWorkerRunning()

          const res = await fetch(TRANSCRIBE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ audioPath: wavPath }),
          })
          const body = (await res.json()) as { ok: boolean; text?: string; error?: string }
          if (!body.ok) {
            return json({ ok: false, error: body.error || 'Transcription failed' }, { status: 500 })
          }
          return json({ ok: true, text: body.text })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        } finally {
          await fs.rm(inputPath, { force: true })
          await fs.rm(wavPath, { force: true })
        }
      },
    },
  },
})
