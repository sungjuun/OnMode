export type Method = 'pomodoro' | 'flow' | 'deep' | 'custom'
export type ActivityKind = 'subject' | 'book'
export interface Profile { name: string; goalMinutes: number; notifications: boolean }
export interface Certification { id: string; name: string; examDate: string; result: 'pending' | 'passed' | 'failed' }
export interface Activity {
  id: string; kind: ActivityKind; name: string; certificationId?: string;
  goalMinutes?: number; author?: string; pages?: number; currentPage?: number; goalPages?: number;
}
export interface Journal { id: string; activityId: string; date: string; text: string; amount: number }
export interface Timer {
  id: string; method: Method; activityId: string | null; targetSeconds: number | null;
  restSeconds: number; startedAt: number; elapsedMs: number; activeSince: number | null;
}
export interface FocusRecord {
  id: string; method: Method; activityId: string | null; seconds: number; endedAt: number;
  xp: number; coins: number;
}
export interface BreakTimer { endAt: number; long: boolean }
export interface Snapshot {
  profile: Profile; certifications: Certification[]; activities: Activity[]; journal: Journal[];
  records: FocusRecord[]; timer: Timer | null; inventory: string[]; placed: string[];
}
export interface View { snapshot: Snapshot; serverTime?: number }
export type Command =
  | { type: 'profile'; value: Profile }
  | { type: 'certification'; value: Certification }
  | { type: 'activity'; value: Activity }
  | { type: 'journal'; value: Journal }
  | { type: 'start'; value: Pick<Timer, 'id' | 'method' | 'activityId' | 'targetSeconds' | 'restSeconds'> }
  | { type: 'pause' | 'resume' | 'finish'; id: string }
  | { type: 'buy'; id: string }
  | { type: 'place'; id: string; placed: boolean }

export interface Repository { load(): Promise<View>; execute(command: Command): Promise<View> }

export const defaultProfile: Profile = { name: '집중러', goalMinutes: 120, notifications: false }
export const emptySnapshot = (): Snapshot => ({
  profile: { ...defaultProfile }, certifications: [], activities: [], journal: [], records: [],
  timer: null, inventory: ['desk', 'chair'], placed: ['desk', 'chair'],
})

export const items = [
  { id: 'desk', name: '원목 책상', category: '가구', price: 0 },
  { id: 'chair', name: '라벤더 의자', category: '가구', price: 0 },
  { id: 'lamp', name: '새벽 조명', category: '소품', price: 1 },
  { id: 'frame', name: '보라빛 액자', category: '소품', price: 3 },
  { id: 'plant', name: '작은 화분', category: '소품', price: 5 },
  { id: 'shelf', name: '오크 책장', category: '가구', price: 10 },
  { id: 'laptop', name: '실버 노트북', category: '기기', price: 12 },
  { id: 'wall', name: '라벤더 벽지', category: '테마', price: 15 },
] as const

export const methods: Record<Method, { name: string; detail: string; focus: number | null; rest: number }> = {
  pomodoro: { name: '뽀모도로', detail: '25분 집중 · 5분 휴식', focus: 25, rest: 5 },
  flow: { name: '플로우타임', detail: '시간 제한 없이 집중', focus: null, rest: 0 },
  deep: { name: '50/10', detail: '50분 집중 · 10분 휴식', focus: 50, rest: 10 },
  custom: { name: '사용자 지정', detail: '나에게 맞는 리듬', focus: 30, rest: 5 },
}
export const MAX_FOCUS_SECONDS = 12 * 3600
export const MIN_REWARD_SECONDS = 60
export const levelFor = (xp: number) => 1 + Math.floor(xp / 100)
export const totals = (s: Snapshot) => ({
  xp: s.records.reduce((a, b) => a + b.xp, 0),
  coins: s.records.reduce((a, b) => a + b.coins, 0) - items.reduce((a, b) => a + (s.inventory.includes(b.id) ? b.price : 0), 0),
})
