import { Routes, Route, Navigate } from 'react-router-dom';
import TopBar from './components/TopBar';
import InstallPrompt from './pwa/InstallPrompt';
import Home from './pages/Home';
import Show from './pages/Show';
import Episode from './pages/Episode';
import Playlist from './pages/Playlist';
import ForYou from './pages/ForYou';

export default function App() {
  return (
    <div className="app-shell">
      <TopBar />
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/show" element={<Show />} />
          <Route path="/episode" element={<Episode />} />
          <Route path="/for-you" element={<ForYou />} />
          <Route path="/playlist" element={<Playlist />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <InstallPrompt />
    </div>
  );
}
