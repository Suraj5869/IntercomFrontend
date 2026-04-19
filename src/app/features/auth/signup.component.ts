import { Component } from '@angular/core';
import { AuthService } from 'src/app/core/services/auth.service';
import { Router } from '@angular/router';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.component.html',
  styleUrls: ['./login.component.css']
})
export class SignupComponent {

  name: string = '';
  email: string = '';
  password: string = '';

  constructor(private auth: AuthService, private router: Router, private toast: ToastService) {}

  signup() {
    const payload = {
      name: this.name,
      email: this.email,
      password: this.password
    };

    this.auth.signup(payload).subscribe({
      next: () => {
        this.toast.success('Signup successful 🎉');
        this.router.navigate(['/login']);
      },
      error: (err) => {
        console.error(err);
        this.toast.error('Signup failed');
      }
    });
  }
}