import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface Toast {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  type?: ToastType;
  label?: string;
  message?: string;
  duration?: number;
}
@Injectable({ providedIn: 'root' })
export class ToastService {
  
  ICONS = {
  success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
};
 
 private getToastContainer(): HTMLElement {
    let container = document.querySelector('.toast-container') as HTMLElement;

    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    return container;
  }

  showToast({
    type = 'info',
    label,
    message,
    duration = 4000
  }: ToastOptions): HTMLElement {

    const container = this.getToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    toast.innerHTML = `
      <div class="toast-icon">
        ${this.ICONS[type]}
      </div>

      <div class="toast-body">
        ${label ? `<div class="toast-title">${label}</div>` : ''}
        <div class="toast-msg"></div>
      </div>

      <button class="toast-close" aria-label="Dismiss">
        &times;
      </button>

      ${
        duration > 0
          ? '<div class="toast-progress"></div>'
          : ''
      }
    `;

    const messageElement = toast.querySelector('.toast-msg') as HTMLElement;
    messageElement.textContent = message ?? '';

    container.appendChild(toast);

    const removeToast = () => {
      toast.classList.add('closing');

      toast.addEventListener(
        'animationend',
        () => toast.remove(),
        { once: true }
      );
    };

    const closeButton = toast.querySelector('.toast-close') as HTMLButtonElement;

    closeButton.addEventListener('click', removeToast);

    if (duration > 0) {

      const progressBar = toast.querySelector('.toast-progress') as HTMLElement;

      if (progressBar) {
        progressBar.style.animationDuration = `${duration}ms`;
      }

      setTimeout(removeToast, duration);
    }

    return toast;
  }
}