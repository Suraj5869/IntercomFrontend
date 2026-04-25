import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivate, CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): boolean {

    const token = localStorage.getItem('token');

    if (token) return true;

    // 🔥 redirect to login with return URL
    this.router.navigate(['/login'], {
      queryParams: { returnUrl: state.url }
    });

    return false;
  }
};
