import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useStore } from './store/useStore';
import { getToolDefs, invokeTool } from './webmcp/tools';

declare global {
  interface Window {
    earshot: { store: typeof useStore; invokeTool: typeof invokeTool; tools: typeof getToolDefs };
  }
}
// Debug handle for the browser console; harmless in production.
window.earshot = { store: useStore, invokeTool, tools: getToolDefs };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
