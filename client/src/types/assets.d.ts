// Ambient declarations for side-effect asset imports resolved by the bundler
// (webpack/turbopack). Next.js handles these at build time; this file lets
// tsc/tsserver resolve them too.
declare module '*.css';
declare module '*.scss';
