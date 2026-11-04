export function Room({ placed }: { placed: string[] }) {
  const has = (id: string) => placed.includes(id)
  return <svg viewBox="0 0 640 356" role="img" aria-label="아이템이 배치된 나만의 공부방" className="room-svg">
    <defs><linearGradient id="wallFill" x2="0" y2="1"><stop stopColor={has('wall') ? 'var(--room-theme-start)' : 'var(--room-wall-start)'} /><stop offset="1" stopColor={has('wall') ? 'var(--room-theme-end)' : 'var(--room-wall-end)'} /></linearGradient><linearGradient id="windowFill" x2="0" y2="1"><stop stopColor="var(--room-sky-start)" /><stop offset="1" stopColor="var(--room-sky-end)" /></linearGradient></defs>
    <path fill="url(#wallFill)" d="M0 0h640v257H0z" /><path fill="var(--room-floor)" d="M0 257h640v99H0z" />
    <path d="M0 253h640M0 285h640M0 318h640m-514-61-69 99m228-99-15 99m165-99 41 99m109-99 55 60" stroke="var(--room-floor-line)" strokeOpacity=".6" fill="none" />
    <ellipse cx="324" cy="309" rx="217" ry="32" fill="var(--room-rug-edge)" /><ellipse cx="324" cy="307" rx="207" ry="25" fill="var(--room-rug)" />
    <rect x="240" y="37" width="154" height="108" rx="12" fill="var(--room-window)" /><rect x="248" y="45" width="138" height="92" rx="7" fill="url(#windowFill)" /><circle cx="351" cy="70" r="15" fill="#fff2c2" />
    <path d="m248 119 28-27 29 20 22-13 32 24 27-12v26H248z" fill="var(--room-hills)" /><path d="M317 46v90m-68-45h136" stroke="var(--room-window)" strokeWidth="5" /><path d="M231 147h172" stroke="#b6a5df" strokeWidth="8" strokeLinecap="round" />
    {has('shelf') && <g><rect x="51" y="123" width="100" height="146" rx="7" fill="#c3988d" /><path d="M59 170h84m-84 46h84" stroke="#f3d2ae" strokeWidth="7" /><path d="M68 140v25m14-30v30m14-22v22m-27 25v21m20-25v25" stroke="#7766bd" strokeWidth="9" /><path d="M64 252h65" stroke="#f3d2ae" strokeWidth="9" /></g>}
    {has('frame') && <g><rect x="444" y="70" width="64" height="70" rx="4" fill="#af91d4" /><rect x="451" y="77" width="50" height="56" fill="#faf3ff" /><path d="m462 117 14-28 14 28Z" fill="#bba5f2" /><circle cx="478" cy="99" r="6" fill="#f4b9be" /></g>}
    {has('desk') && <g><path d="M202 220h13v69h-13zm224 0h13v69h-13z" fill="#a47b82" /><rect x="185" y="203" width="270" height="18" rx="8" fill="#ceaaa0" /><path d="M194 207h251" stroke="#f0c5b0" strokeWidth="3" strokeLinecap="round" /></g>}
    {has('lamp') && <g><ellipse cx="401" cy="199" rx="20" ry="5" fill="#7664ad" /><path d="M402 197v-43l-15-15" stroke="#7664ad" strokeWidth="6" fill="none" /><path d="M374 134q9-8 17 0l12 18h-41z" fill="#ffca83" /><path d="M366 155h34" stroke="#fff2c2" strokeWidth="4" /></g>}
    {has('laptop') && <g><rect x="283" y="158" width="71" height="41" rx="4" fill="#7365a4" /><rect x="288" y="163" width="61" height="31" rx="2" fill="#b9bdff" /><rect x="277" y="197" width="83" height="6" rx="2" fill="#aaa0cb" /></g>}
    {has('chair') && <g><path d="M293 271v28m53-28v28" stroke="#7764a4" strokeWidth="8" strokeLinecap="round" /><rect x="284" y="224" width="71" height="51" rx="13" fill="#a18ce1" /><rect x="293" y="232" width="53" height="29" rx="8" fill="#b7a4ef" /><rect x="281" y="268" width="77" height="11" rx="5" fill="#8873c2" /></g>}
    {has('plant') && <g><path d="M527 253q-29-21-12-44 16 10 17 37 2-38 26-35 8 19-21 44" fill="#7faea2" /><path d="M514 251h35l-6 26h-23z" fill="#eeb0a8" /></g>}
  </svg>
}
