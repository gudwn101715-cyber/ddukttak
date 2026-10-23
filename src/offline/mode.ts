/** Set only by the self-contained HTML packager; ordinary web builds use the API. */
export function isPortable(): boolean {
  return typeof window !== 'undefined'
    && (window as Window & { __DDUKTTAK_PORTABLE__?: boolean }).__DDUKTTAK_PORTABLE__ === true;
}
