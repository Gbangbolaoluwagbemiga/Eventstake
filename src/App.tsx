import { BrowserRouter, Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import LandingPage from './pages/LandingPage'
import EventsPage from './pages/EventsPage'
import EventDetailPage from './pages/EventDetailPage'
import CheckInPage from './pages/CheckInPage'
import MyEventsPage from './pages/MyEventsPage'
import MyRecordPage from './pages/MyRecordPage'
import CreateEventPage from './pages/CreateEventPage'
import OrganiserDashboardPage from './pages/OrganiserDashboardPage'
import DoorPage from './pages/DoorPage'
import SponsorPoolPage from './pages/SponsorPoolPage'
import CoverLogPage from './pages/CoverLogPage'

export default function App() {
  return (
    <BrowserRouter>
      <div
        className="min-h-dvh"
        style={{ background: 'var(--bg-gradient)' }}
      >
        <NavBar />
        {/* content sits between top bar and bottom nav */}
        <main
          className="max-w-lg mx-auto px-4"
          style={{ paddingTop: '12px', paddingBottom: '80px' }}
        >
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/:eventId" element={<EventDetailPage />} />
            <Route path="/checkin/:eventId" element={<CheckInPage />} />
            <Route path="/my/events" element={<MyEventsPage />} />
            <Route path="/my/record" element={<MyRecordPage />} />
            <Route path="/create" element={<CreateEventPage />} />
            <Route path="/organiser/:eventId" element={<OrganiserDashboardPage />} />
            <Route path="/organiser/:eventId/door" element={<DoorPage />} />
            <Route path="/pool" element={<SponsorPoolPage />} />
            <Route path="/covers" element={<CoverLogPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
