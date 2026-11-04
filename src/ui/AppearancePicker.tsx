import { Monitor, Moon, Sun } from 'lucide-react'
import { setAppearance, useAppearance } from '../state/appearance'

const choices = [['light', '밝게', Sun], ['dark', '어둡게', Moon], ['system', '시스템', Monitor]] as const

export function AppearancePicker() {
  const preference = useAppearance()
  return <fieldset className="appearance-picker">
    <legend>화면 테마</legend>
    <p className="muted text-sm">이 기기에 바로 적용돼요.</p>
    <div className="segmented">
      {choices.map(([id, label, Icon]) => <button type="button" key={id} aria-pressed={preference === id} onClick={() => setAppearance(id)}>
        <Icon size={15} aria-hidden />{label}
      </button>)}
    </div>
  </fieldset>
}
