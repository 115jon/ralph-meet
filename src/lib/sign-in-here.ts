/**
 * Send the user to sign in, and back to exactly where they are (path,
 * query and hash) once they have. Used by every "Sign in" key the
 * connection UI offers (cold load, overlay, connection strip).
 */
export function signInFromHere() {
  const { pathname, search, hash } = window.location;
  window.location.assign(
    `/sign-in?redirect_url=${encodeURIComponent(`${pathname}${search}${hash}`)}`,
  );
}
