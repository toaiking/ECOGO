
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Service Worker Registration for Auto-Update
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('SW registered: ', registration);
      
      // Force update check
      registration.update();

      registration.onupdatefound = () => {
          const installingWorker = registration.installing;
          if (installingWorker == null) return;
          installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                  if (navigator.serviceWorker.controller) {
                      console.log('New content available, reloading...');
                      // Force reload when new content is available and installed
                      window.location.reload();
                  }
              }
          };
      };
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
  
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
          window.location.reload();
          refreshing = true;
      }
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
