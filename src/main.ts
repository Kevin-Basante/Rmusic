import './style.css';
import { App } from './ui/App';

const root = document.querySelector<HTMLElement>('#app');
if (root) void new App(root).init();
