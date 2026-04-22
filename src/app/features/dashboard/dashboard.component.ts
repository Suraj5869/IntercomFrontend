import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent {
  roomCode: string = '';
  userId: string = '';

  constructor(private http: HttpClient, private router: Router, private toast: ToastService, private route: ActivatedRoute) {
    this.userId = localStorage.getItem('userId') || '';
  }

  ngOnInit() {
  this.roomCode = this.route.snapshot.paramMap.get('roomCode') || '';
  this.joinRoom();
}

  createRoom() {
    this.http.post('https://intercombackend-5h0c.onrender.com/api/Room/create', {
      userId: this.userId
    }).subscribe((res: any) => {
      const code = res.roomCode || res;

      // store roomCode
      localStorage.setItem('roomCode', code);

      // redirect to room
      this.router.navigate(['/room']);
      this.toast.info('Room created successfully 🎉');
    });
  }

  joinRoom() {
    if (!this.roomCode) {
      this.toast.error('Enter room code');
      return;
    }

    this.http.post('https://intercombackend-5h0c.onrender.com/api/Room/join', {
      userId: this.userId,
      code: this.roomCode
    }).subscribe(() => {
      localStorage.setItem('roomCode', this.roomCode);
      this.router.navigate(['/room']);
      this.toast.success('Room joined successfully 🎉');
    });
  }
}
