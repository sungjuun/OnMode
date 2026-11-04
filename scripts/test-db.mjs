import assert from 'node:assert/strict'
import { execFileSync, execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const local = JSON.parse(execSync('npx --yes supabase@3.0.0 status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
const url = new URL(local.API_URL)
assert.equal(url.origin, 'http://127.0.0.1:56321', 'Use the isolated ONMODE local stack')
assert.ok(local.PUBLISHABLE_KEY?.startsWith('sb_publishable_'))
const client = () => createClient(url.origin, local.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const uuid = randomUUID
const unwrap = ({ data, error }) => { if (error) throw new Error(error.message); return data }
const call = async (app, name, args) => unwrap(await app.rpc(name, args))
const apply = (app, command) => call(app, 'onmode_command', { command })
const mutate = (app, action, payload) => call(app, 'onmode_group_change', { action, payload })
const denied = async promise => assert.equal((await promise).error?.code, '42501')
const sessionId = uuid(), activityId = uuid(), certificationId = uuid(), bookId = uuid()
const uid = []
const clients = [client(), client(), client(), client()]
const [owner, member, outsider, anon] = clients
const sql = statement => execFileSync('docker', ['exec', 'supabase_db_onmode', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', statement], { encoding: 'utf8' }).trim()
const id = app => uid[clients.indexOf(app)]
let gid, publicId
const update = () => {
  let resolve
  const done = new Promise(r => { resolve = r })
  return { resolve, done }
}
async function within(promise, label, ms = 20000) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Realtime timed out: ' + label)), ms) })])
  } finally { clearTimeout(timer) }
}
try {
  await denied(anon.rpc('onmode_snapshot'))
  for (const app of [owner, member, outsider]) {
    const email = 'onmode-' + uuid() + '@example.com'
    const password = 'LocalOnly!' + uuid()
    const signup = unwrap(await app.auth.signUp({ email, password }))
    assert.ok(signup.user?.id)
    uid.push(signup.user.id)
    unwrap(await app.auth.signOut({ scope: 'local' }))
    assert.equal(unwrap(await app.auth.signInWithPassword({ email, password })).user.id, signup.user.id)
  }
  assert.deepEqual((await call(owner, 'onmode_snapshot')).snapshot.inventory.sort(), ['chair', 'desk'])
  await apply(owner, { type: 'profile', value: { name: '그룹장 테스트', goalMinutes: 120, notifications: false } })
  await apply(owner, { type: 'certification', value: { id: certificationId, name: 'SQLD', examDate: '2027-03-05', result: 'pending' } })
  await apply(owner, { type: 'activity', value: { id: activityId, kind: 'subject', name: '데이터베이스', certificationId, goalMinutes: 120 } })
  await apply(owner, { type: 'activity', value: { id: bookId, kind: 'book', name: '독서 테스트', author: '저자', pages: 100, currentPage: 0, goalPages: 10 } })
  const updated = await apply(owner, { type: 'journal', value: { id: uuid(), activityId: bookId, date: '2026-11-04', text: '메모', amount: 20 } })
  assert.equal(updated.snapshot.activities.find(a => a.id === bookId).currentPage, 20)
  assert.deepEqual(unwrap(await outsider.from('activities').select('id').eq('id', activityId)), [])
  assert.deepEqual((await call(outsider, 'onmode_snapshot')).snapshot.activities, [])
  await denied(outsider.rpc('onmode_command', { command: { type: 'journal', value: { id: uuid(), activityId, date: '2026-11-04', text: 'invalid', amount: 1 } } }))
  await denied(owner.from('reward_transactions').insert({ user_id: id(owner), coins: 1000, xp: 1000 }))

  const groupPayload = { name: '권한 테스트 ' + uuid().slice(0, 7), description: '', goalMinutes: 300 }
  gid = await mutate(owner, 'create', { ...groupPayload, isPublic: false })
  publicId = await mutate(owner, 'create', { ...groupPayload, isPublic: true })
  const discovery = await call(outsider, 'onmode_groups')
  assert.equal(discovery.find(g => g.id === gid), undefined)
  assert.equal(discovery.find(g => g.id === publicId)?.isPublic, true)
  await mutate(outsider, 'join', { id: publicId })
  const ranking = app => call(app, 'onmode_ranking', { group_id: gid, zone: 'Asia/Seoul' })
  await denied(outsider.rpc('onmode_ranking', { group_id: gid, zone: 'Asia/Seoul' }))
  assert.deepEqual(unwrap(await outsider.from('group_updates').select('group_id').eq('group_id', gid)), [])
  await denied(member.rpc('onmode_group_change', { action: 'join', payload: { id: gid } }))
  const { inviteCode } = (await call(owner, 'onmode_groups')).find(g => g.id === gid)
  assert.match(inviteCode, /^[a-f0-9]{16}$/)
  await mutate(member, 'invite', { code: inviteCode })
  assert.equal((await call(member, 'onmode_groups')).find(g => g.id === gid).inviteCode, undefined)
  await denied(member.rpc('onmode_group_change', { action: 'goal', payload: { id: gid, goalMinutes: 1 } }))
  await mutate(owner, 'goal', { id: gid, goalMinutes: 240 })

  const subscribed = update()
  const changed = update()
  const channel = member.channel('onmode-db-test:' + gid, { config: { postgres_changes_options: { wait: true } } }).on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'group_updates', filter: 'group_id=eq.' + gid,
  }, change => changed.resolve(change.new.group_id))
  channel.subscribe(status => { if (status === 'SUBSCRIBED') subscribed.resolve() })
  await within(subscribed.done, 'subscription')

  const focus = { method: 'flow', activityId, targetSeconds: null, restSeconds: 0 }
  const forged = uuid()
  await apply(owner, { type: 'start', value: { ...focus, id: forged, elapsedMs: 900_000, startedAt: 0 } })
  const forgedResult = await apply(owner, { type: 'finish', id: forged, seconds: 1800, coins: 999 })
  assert.ok(!forgedResult.snapshot.records.some(r => r.coins > 0))
  await apply(owner, { type: 'start', value: { ...focus, id: sessionId } })
  assert.equal(await within(changed.done, 'group update'), gid)
  assert.ok((await ranking(member)).members.find(m => m.id === id(owner)).focusingUntil > Date.now())
  const duplicate = await owner.rpc('onmode_command', { command: { type: 'start', value: { ...focus, id: uuid() } } })
  assert.equal(duplicate.error?.code, '23505')
  await apply(owner, { type: 'pause', id: sessionId })
  assert.equal((await ranking(member)).members.find(m => m.id === id(owner)).focusingUntil, null)
  await apply(owner, { type: 'resume', id: sessionId })
  // Age a real active segment on the disposable DB; the public API cannot set elapsed time.
  sql("update public.focus_sessions set active_since = active_since - interval '65 seconds' where id = '" + sessionId + "'")
  await Promise.all([apply(owner, { type: 'finish', id: sessionId }), apply(owner, { type: 'finish', id: sessionId })])
  const rewards = unwrap(await owner.from('reward_transactions').select('coins,xp').eq('session_id', sessionId))
  assert.deepEqual(rewards, [{ coins: 1, xp: 5 }])
  assert.deepEqual(unwrap(await member.from('focus_sessions').select('id').eq('id', sessionId)), [])
  const result = await ranking(member)
  const row = result.members.find(m => m.id === id(owner))
  assert.ok(row.today >= 65 && row.week >= 65 && row.total >= 65)
  assert.ok(result.total >= 65 && result.week >= 65)
  await Promise.all([apply(owner, { type: 'buy', id: 'lamp' }), apply(owner, { type: 'buy', id: 'lamp' })])
  await apply(owner, { type: 'place', id: 'lamp', placed: true })
  assert.deepEqual(unwrap(await owner.from('reward_transactions').select('coins').eq('item_id', 'lamp')), [{ coins: -1 }])
  assert.ok((await call(owner, 'onmode_snapshot')).snapshot.placed.includes('lamp'))

  await mutate(owner, 'leave', { id: gid })
  assert.equal((await call(member, 'onmode_groups')).find(g => g.id === gid).role, 'owner')
  assert.ok((await ranking(member)).total >= 65)
  await denied(owner.rpc('onmode_ranking', { group_id: gid, zone: 'Asia/Seoul' }))
} finally {
  for (const app of clients) {
    await app.auth.signOut({ scope: 'local' })
    await app.removeAllChannels()
    await app.auth.dispose()
  }
  for (const groupId of [gid, publicId].filter(Boolean)) sql("delete from public.study_groups where id = '" + groupId + "'")
  for (const userId of uid) sql("delete from auth.users where id = '" + userId + "'")
}
await new Promise(resolve => process.stdout.write('Local Supabase passed: Auth, REST/RLS, group permissions, Realtime, ranking, atomic rewards and inventory.\n', resolve))
// The SDK transport can keep timers alive after disconnect; this is a one-shot check.
process.exit(0)
