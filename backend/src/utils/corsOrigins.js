// Vercel preview deployments of this project only. Any *.vercel.app would let
// a site anyone can deploy make credentialed calls to the API, so a preview
// host must start with VERCEL_PROJECT (e.g. "agrifair" allows agrifair.vercel.app
// and agrifair-git-main-you.vercel.app). Production uses CORS_ORIGINS.
// Read on each call: index.js loads .env after its imports have run.
export const isVercelOrigin = (origin, project = process.env.VERCEL_PROJECT) => {
  project = String(project || '').trim().toLowerCase();
  if (!project) return false;
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === 'https:' && (
      hostname === `${project}.vercel.app`
      || (hostname.startsWith(`${project}-`) && hostname.endsWith('.vercel.app'))
    );
  } catch {
    return false;
  }
};
