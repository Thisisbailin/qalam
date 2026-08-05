import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tailwind.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

const hasDesktopBridge = Boolean(
  (window as Window & {
    styloDesktop?: { isDesktop?: boolean };
    qalamDesktop?: { isDesktop?: boolean };
  }).styloDesktop?.isDesktop ||
  (window as Window & { qalamDesktop?: { isDesktop?: boolean } }).qalamDesktop?.isDesktop
);
const hasElectronUserAgent = /\bElectron\/\d+/i.test(window.navigator.userAgent);
const isDesktop = hasDesktopBridge || hasElectronUserAgent;
const isWebAppPreview = !isDesktop && new URL(window.location.href).searchParams.get('app') === '1';

document.documentElement.classList.remove(isDesktop ? 'stylo-web-runtime' : 'stylo-desktop-runtime');
document.documentElement.classList.add(isDesktop ? 'stylo-desktop-runtime' : 'stylo-web-runtime');

const renderWorkspaceApp = () => {
  Promise.all([import('./App'), import('./lib/auth'), import('./components/AppErrorBoundary')]).then(([
    { default: App },
    { AuthProvider },
    { AppErrorBoundary },
  ]) => {
    root.render(
      <React.StrictMode>
        <AuthProvider>
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </AuthProvider>
      </React.StrictMode>
    );
  }).catch((error) => {
    console.error('Stylo workspace failed to load', error);
  });
};

if (isDesktop) {
  const bootScreen = document.getElementById('stylo-desktop-boot');
  const dismissBootScreen = () => {
    if (!bootScreen || bootScreen.classList.contains('stylo-desktop-boot--exit')) return;
    bootScreen.classList.add('stylo-desktop-boot--exit');
    window.setTimeout(() => bootScreen.remove(), 240);
  };
  const readyObserver = new MutationObserver(() => {
    if (rootElement.childElementCount === 0) return;
    readyObserver.disconnect();
    window.requestAnimationFrame(() => window.requestAnimationFrame(dismissBootScreen));
  });
  readyObserver.observe(rootElement, { childList: true });

  renderWorkspaceApp();
  window.setTimeout(() => {
    if (rootElement.childElementCount > 0) return;
    readyObserver.disconnect();
  }, 15_000);
} else if (isWebAppPreview) {
  renderWorkspaceApp();
} else {
  import('./components/LandingPage').then(({ LandingPage }) => {
    root.render(
      <React.StrictMode>
        <LandingPage />
      </React.StrictMode>
    );
  }).catch((error) => {
    console.error('Stylo website failed to load', error);
  });
}
