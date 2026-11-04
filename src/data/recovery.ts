import { createRecoveryAuth, recoveryPath } from './supabase'

export async function requestPasswordReset(email: string) {
  const auth = createRecoveryAuth()
  try {
    const { error } = await auth.resetPasswordForEmail(email, {
      redirectTo: new URL(recoveryPath, window.location.origin).href,
    })
    if (error && error.code !== 'user_not_found') throw error
  } finally {
    await auth.dispose()
  }
}

export async function openPasswordReset(code: string, flowId?: string) {
  const auth = createRecoveryAuth()
  try {
    const { data, error } = await auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined)
    if (error || !data.session) throw Error('재설정 링크를 확인할 수 없습니다.')
  } catch (error) {
    await auth.dispose()
    throw error
  }
  let closed = false
  return {
    async update(password: string) {
      if (closed) throw Error('재설정 세션이 종료됐어요.')
      const { error } = await auth.updateUser({ password })
      if (error) throw error
    },
    async close() {
      if (closed) return
      closed = true
      try { await auth.signOut({ scope: 'local' }) } catch { /* The isolated session is discarded below. */ }
      finally { await auth.dispose() }
    },
  }
}
