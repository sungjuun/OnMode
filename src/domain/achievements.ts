import type { Snapshot } from './model'
import { sum } from './stats'

export function achievementsFor(s: Snapshot) {
  return [
    { title: '첫 집중', description: '첫 번째 집중 기록 남기기', earned: s.records.length > 0 },
    { title: '몰입의 시작', description: '누적 60분 집중하기', earned: sum(s.records) >= 3600 },
    { title: '나의 공간', description: '기본 가구 외 새 아이템 얻기', earned: s.inventory.some(id => id !== 'desk' && id !== 'chair') },
  ]
}
