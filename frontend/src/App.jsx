import { Route, Routes } from 'react-router-dom'
import MapPage from './pages/MapPage.jsx'
import Page2 from './pages/Page2.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MapPage />} />
      <Route path="/page2" element={<Page2 />} />
    </Routes>
  )
}
