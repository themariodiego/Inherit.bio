// The igv package's `browser` field points at its UMD build, which Turbopack
// compiles to a side-effect global with an empty module namespace. We import
// the ESM build by subpath instead; it has no bundled type declarations, so
// declare it here (the component narrows it to the API surface it uses).
declare module "igv/dist/igv.esm.js";
