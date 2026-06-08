import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import PhaserApp from './PhaserApp.jsx';
import './styles.css';

// The Phaser town is now the default engine. The previous React Flow canvas is
// kept as a fallback at ?engine=reactflow until the Phaser version is confirmed
// in real use (then it can be removed). StrictMode is intentionally omitted —
// its dev double-mount would boot two Phaser games.
const engine = new URLSearchParams(window.location.search).get('engine');
const Root = engine === 'reactflow' ? App : PhaserApp;

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
