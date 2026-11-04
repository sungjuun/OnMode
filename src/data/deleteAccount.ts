import { createVerificationClient } from './supabase'

export const deletionConfirmation = '계정 삭제'

export async function deleteAccount(user: { id: string; email: string }, password: string, confirmation: string) {
  const verification = createVerificationClient()
  try {
    const login = await verification.auth.signInWithPassword({ email: user.email, password })
    if (login.error?.code === 'invalid_credentials' || (!login.error && login.data.user?.id !== user.id)) {
      throw Error('비밀번호를 다시 확인해 주세요.')
    }
    if (login.error || !login.data.session) throw Error('본인 확인에 실패했어요. 잠시 후 다시 시도해 주세요.')
    const { data, error } = await verification.rpc('onmode_delete_account', { confirmation })
    if (error || data !== true) throw Error('계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.')
  } finally {
    await verification.auth.signOut({ scope: 'local' }).catch(() => undefined)
    await verification.auth.dispose()
  }
}
