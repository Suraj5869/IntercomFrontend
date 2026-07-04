import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from 'src/app/core/services/auth.service';
import { ToastService } from 'src/app/core/services/toast.service';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css'],
})
export class DashboardComponent {
  roomCode: string = '';
  userId: string = '';
  baseUrl = `${environment.apiUrl}/Room`;

  constructor(
    private http: HttpClient,
    private router: Router,
    private toast: ToastService,
    private route: ActivatedRoute,
    private auth: AuthService,
  ) {
    this.userId = localStorage.getItem('userId') || '';
  }

  ngOnInit() {
    this.roomCode = this.route.snapshot.paramMap.get('roomCode') || '';
    if (this.roomCode) {
      this.joinRoom();
    }
  }

  createRoom() {
    this.http
      .post(this.baseUrl + '/create', {
        userId: this.userId,
      })
      .subscribe((res: any) => {
        const code = res.roomCode;
        const roomId = res.roomId;
        // store roomCode
        localStorage.setItem('roomCode', code);
        localStorage.setItem('roomId', roomId);
        localStorage.setItem('roomCreatedBy', res.createdBy);
        // redirect to room
        this.router.navigate(['/room']);
        this.toast.showToast({
          type: 'success',
          message: 'Room created successfully 🎉',
        });
      });
  }

  joinRoom() {
    if (!this.roomCode) {
      this.toast.showToast({ type: 'info', message: 'Enter room code' });
      return;
    }

    this.http
      .post(this.baseUrl + '/join', {
        userId: this.userId,
        code: this.roomCode,
      })
      .subscribe((res: any) => {
        localStorage.setItem('roomCode', this.roomCode);
        localStorage.setItem('roomId', res.roomId);
        localStorage.setItem('roomCreatedBy', res.createdBy);
        this.router.navigate(['/room']);
        this.toast.showToast({
          type: 'success',
          message: 'Room joined successfully 🎉',
        });
      });
  }

  logout() {
    localStorage.clear(); // 🔥 removes token, user, roomCode, etc.
    this.auth.logout(); // 🔥 clear any auth state if needed
    this.router.navigate(['/login']);
  }
}
