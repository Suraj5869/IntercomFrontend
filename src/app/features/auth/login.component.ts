import { Component } from '@angular/core';
import { AuthService } from 'src/app/core/services/auth.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent {
  email = '';
  password = '';
  showPassword = false;
  isLoading = false;

  constructor(
    readonly auth: AuthService,
    readonly router: Router,
    readonly toast: ToastService,
    readonly route: ActivatedRoute
  ) {}

  login() {
    if (this.isLoading) return;

    this.isLoading = true;

    this.auth.login({ email: this.email, password: this.password }).subscribe({
      next: (res: any) => {
        this.auth.saveToken(res.token);
        localStorage.setItem('userId', res.userId);
        localStorage.setItem('userName', res.name);

        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        this.router.navigateByUrl(returnUrl || '/dashboard');
        this.toast.showToast({ type: 'success', message: 'Login successful 🎉' });
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Login failed', err);
        this.toast.showToast({ type: 'error', message: 'Invalid credentials' });
        this.isLoading = false;
      },
    });
  }
}