/** @type {import('next').NextConfig} */
// NEXT_EXPORT=1 builds a static export into out/ (GitHub Pages); NEXT_BASE_PATH sets the sub-path it is served from.
const exportMode = process.env.NEXT_EXPORT === '1';
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  ...(exportMode ? { output: 'export', trailingSlash: true, images: { unoptimized: true } } : {}),
  ...(process.env.NEXT_BASE_PATH ? { basePath: process.env.NEXT_BASE_PATH } : {})
};
export default nextConfig;
