import { Component } from '@angular/core';
import { AuthService } from 'src/app/core/services/auth.service';
import { Router } from '@angular/router';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {

  email: string = '';
  password: string = '';

  constructor(private auth: AuthService, private router: Router, private toast: ToastService) {}

  login() {
    const payload = {
      email: this.email,
      password: this.password
    };

    this.auth.login(payload).subscribe({
      next: (res: any) => {
        console.log('Login success', res);

        // store userId (temporary, later JWT)
        localStorage.setItem('userId', res.userId);
      localStorage.setItem('userName', res.name);

        this.router.navigate(['/dashboard']);
        this.toast.success('Login successful 🎉');
      },
      error: (err) => {
        console.error('Login failed', err);
        this.toast.error('Invalid credentials');
      }
    });
  }
}