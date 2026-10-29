import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
// Before App, so page styles (imported by the pages) win over the shared ones.
import './index.css';
import './motion/motion.css';
import App from './App.jsx';

// Scopes the motion kit's "hidden until revealed" states, so content stays
// visible if this script never runs.
document.documentElement.classList.add('af-motion');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
