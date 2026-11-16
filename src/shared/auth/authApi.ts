import { auth_api, api } from '@/shared/api/httpClient'
import { unwrap } from '@/shared/api/response'
import type { UsrSignup, UsrLogin, UsrProfile, UsrProfileUpdate } from './types'

// Login endpoint - using x-www-form-urlencoded
export async function login(usr: UsrLogin) {
  const params = new URLSearchParams()
  params.append('username', usr.username)
  params.append('password', usr.password)
  params.append('grant_type', 'password')

  return unwrap(
    api.post<{ access_token?: string }>('/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }),
  )
}

// Signup endpoint
export async function usrSignupApi(usr: UsrSignup) {
  return unwrap(api.post('/user_signup', usr))
}

// Send verification code endpoint
export async function sendEmailCode(email: string, purpose: string = 'register') {
  const payload = {
    email: email,
    send_time: new Date().toISOString(),
    purpose: purpose,
  }

  return unwrap(api.post('/emailsmtprequest', payload))
}

// Reset password with the emailed verification code
export async function resetPassword(payload: { email: string; verify_code: string; new_password: string }) {
  return unwrap(api.post('/password_reset', payload))
}

// Get current user info
export async function getCurrentUser() {
  return unwrap(auth_api.get<UsrProfile>('/user'))
}

// Logout endpoint. skipAuthRedirect: an already-expired token returning 401
// here is expected — the 401 handler must not bounce to /login for it.
export async function logoutApi() {
  return unwrap(auth_api.post('/logout', null, { skipAuthRedirect: true } as any))
}

// Update user profile
// Backend supports modifying all fields EXCEPT username and identity via POST /user_change
// Allows password field, type-safe
export async function updateUserProfile(data: Partial<UsrProfileUpdate>) {
  return unwrap(auth_api.post('/user_change', data))
}
