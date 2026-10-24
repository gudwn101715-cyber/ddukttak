import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Studio from './creative/Studio';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary>{new URLSearchParams(window.location.search).get('studio') === 'websites' ? <App /> : <Studio />}</ErrorBoundary></React.StrictMode>,
);
