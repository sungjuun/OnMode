import { createRoot } from 'react-dom/client'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router'
import { Capacitor } from '@capacitor/core'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/noto-sans-kr'
import './styles.css'
import { AppProvider } from './state/AppProvider'
import { AppShell } from './ui/AppShell'
import { Home } from './pages/Home'
import { Focus } from './pages/Focus'
import { Study } from './pages/Study'
import { Growth } from './pages/Growth'
import { My } from './pages/My'
import { Library } from './pages/Library'
import { Account } from './pages/Account'

const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter
createRoot(document.getElementById('root')!).render(<Router><AppProvider><Routes>
  <Route element={<AppShell />}>
    <Route index element={<Home />} />
    <Route path="focus" element={<Focus />} />
    <Route path="study" element={<Study />} />
    <Route path="growth" element={<Growth />} />
    <Route path="my" element={<My />} />
    <Route path="library" element={<Library />} />
    <Route path="account" element={<Account />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Route>
</Routes></AppProvider></Router>)
