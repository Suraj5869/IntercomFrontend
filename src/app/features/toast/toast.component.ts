import { Component } from '@angular/core';
import { Toast, ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-toast',
  templateUrl: './toast.component.html',
  styleUrls: ['./toast.component.css']
})
export class ToastComponent {
  toasts: Toast[] = [];

  constructor(private toastService: ToastService) {
    // this.toastService.showToast = (options) => {
    //   const toast = { ...options };
    //   this.toasts.push(toast);

    //   setTimeout(() => {
    //     this.toasts.shift();
    //   }, 3000);
    // });
  }
}
