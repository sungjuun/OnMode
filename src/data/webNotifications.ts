import type { FocusNotifications } from '../domain/notifications'

export const webNotifications: FocusNotifications = {
  async request() {
    return 'Notification' in window && (await Notification.requestPermission()) === 'granted'
  },
  finished() {
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('ONMODE · 집중 완료', { body: '집중 기록을 확인하고 잠깐 쉬어가세요.' }) }
      catch { /* Some WebViews require a platform notification adapter. */ }
    }
  },
}
