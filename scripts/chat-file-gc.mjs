import { execSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

// This developer worker is deliberately local-only. No hosted cleanup is run.
function localAdmin() {
  try {
    const stack = JSON.parse(execSync('npx --yes supabase@3.0.0 status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    const key = stack.SECRET_KEY ?? stack.SERVICE_ROLE_KEY
    if (stack.API_URL !== 'http://127.0.0.1:56321' || !key) throw Error()
    return createClient(stack.API_URL, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  } catch {
    throw Error('Start the isolated ONMODE local stack before running file cleanup.')
  }
}
const admin = localAdmin()
let nextSweep = 0
async function work() {
  const scan = Date.now() >= nextSweep
  const { data, error } = await admin.rpc('onmode_chat_file_gc', { action: 'claim', payload: { scan } })
  if (error) throw Error('Local file cleanup could not claim work.')
  if (scan) nextSweep = Date.now() + 10 * 60_000
  let removed = 0
  for (const item of data ?? []) {
    const result = await admin.storage.from('onmode-chat-files').remove([item.objectName])
    const done = await admin.rpc('onmode_chat_file_gc', { action: result.error ? 'retry' : 'done', payload: { id: item.id } })
    if (done.error) throw Error('Local file cleanup could not acknowledge work.')
    if (!result.error) removed++
  }
  if (removed || process.argv.includes('--once')) process.stdout.write('Local chat file cleanup completed: ' + removed + '\n')
}
if (process.argv.includes('--once')) {
  try { await work() } finally { await admin.auth.dispose() }
  process.exit(0)
} else {
  process.stdout.write('Local chat file cleanup is running.\n')
  for (;;) {
    try { await work() } catch { process.stderr.write('Local file cleanup will retry.\n') }
    await new Promise(resolve => setTimeout(resolve, 15000))
  }
}
