import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { NotifierApp } from './NotifierApp';
import './theme.css';
import './index.css';

const isNotifier = new URLSearchParams(window.location.search).has('notifier');

const root = createRoot(document.getElementById('root')!);
root.render(isNotifier ? <NotifierApp /> : <App />);
