import './style.css';
import { App } from './ui/app';
import { initLang } from './ui/i18n';

initLang();

new App(document.querySelector<HTMLElement>('#app')!);
