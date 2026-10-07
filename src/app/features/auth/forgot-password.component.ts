import { Component } from '@angular/core';
import { AuthService } from 'src/app/core/services/auth.service';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./login.component.css']
})
export class ForgotPasswordComponent {
  email = '';
  submitted = false;
  isLoading = false;

  constructor(readonly auth: AuthService, readonly toast: ToastService) {}

  submit() {
    if (!this.email.trim() || this.isLoading) return;

    this.isLoading = true;

    this.auth.forgotPassword(this.email.trim()).subscribe({
      next: () => {
        this.submitted = true;
        this.isLoading = false;
        this.toast.showToast({
          type: 'success',
          message: 'If an account exists, a reset link has been sent.'
        });
      },
      error: (err) => {
        console.error('Forgot password failed', err);
        this.isLoading = false;
        this.toast.showToast({
          type: 'error',
          message: 'Unable to process the request. Please try again.'
        });
      }
    });
  }
}