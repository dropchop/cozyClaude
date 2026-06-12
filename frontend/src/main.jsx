import ReactDOM from 'react-dom/client';
import PhaserApp from './PhaserApp.jsx';
import './styles.css';

// The town renders in a Phaser scene; React owns the HUD (menus/inspector/run bar).
// StrictMode is intentionally omitted — its dev double-mount would boot two Phaser games.
ReactDOM.createRoot(document.getElementById('root')).render(<PhaserApp />);
