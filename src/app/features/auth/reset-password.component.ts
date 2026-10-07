import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/auth.service';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
  styleUrls: ['./login.component.css']
})
export class ResetPasswordComponent {
  token = '';
  newPassword = '';
  confirmPassword = '';
  showPassword = false;
  showConfirmPassword = false;
  isLoading = false;

  constructor(
    readonly route: ActivatedRoute,
    readonly router: Router,
    readonly auth: AuthService,
    readonly toast: ToastService
  ) {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
  }

  submit() {
    if (this.isLoading) {
      return;
    }

    if (!this.token) {
      this.toast.showToast({ type: 'error', message: 'This password reset link is invalid.' });
      return;
    }

    if (this.newPassword.length < 8) {
      this.toast.showToast({ type: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.toast.showToast({ type: 'error', message: 'Passwords do not match.' });
      return;
    }

    this.isLoading = true;

    this.auth.resetPassword(this.token, this.newPassword).subscribe({
      next: () => {
        this.toast.showToast({ type: 'success', message: 'Password reset successful. Please log in.' });
        this.router.navigate(['/login']);
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Reset password failed', err);
        this.toast.showToast({
          type: 'error',
          message: err?.error?.message ?? 'This reset link is invalid or expired.'
        });
      }
    });
  }
}