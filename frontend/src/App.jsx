import { Route, Routes } from 'react-router-dom'
import MapPage from './pages/MapPage.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MapPage />} />
    </Routes>
  )
}
