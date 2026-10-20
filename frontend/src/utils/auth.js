/**
 * The signed-in session.
 *
 * Kept in sessionStorage by default, so it ends when the tab closes - right
 * for a shared computer. "Keep me signed in" puts it in localStorage instead,
 * where it survives until sign-out or until the token expires on the server.
 */

const KEYS = ['token', 'user'];

function store() {
  try {
    return localStorage.getItem('token') ? localStorage : sessionStorage;
  } catch {
    return sessionStorage;
  }
}

export function saveSession({ token, user }, { remember = false } = {}) {
  clearSession();
  const target = remember ? localStorage : sessionStorage;
  target.setItem('token', token);
  target.setItem('user', JSON.stringify(user));
}

export function getToken() {
  try {
    return store().getItem('token');
  } catch {
    return null;
  }
}

export function getSessionUser() {
  try {
    return JSON.parse(store().getItem('user') || 'null');
  } catch {
    return null;
  }
}

/** Updates the stored user (for example, a status that changed) in place. */
export function saveSessionUser(user) {
  try {
    store().setItem('user', JSON.stringify(user));
  } catch {
    /* storage unavailable: the page still has it in memory */
  }
}

export function clearSession() {
  for (const target of [sessionStorage, localStorage]) {
    try {
      KEYS.forEach((key) => target.removeItem(key));
    } catch {
      /* storage unavailable: nothing to clear */
    }
  }
}

/** Role → default dashboard path */
export function getHomePath(role) {
  if (role === 'superadmin') return '/superadmin';
  if (role === 'seller') return '/client';
  if (role === 'rider') return '/rider';
  return '/';
}
