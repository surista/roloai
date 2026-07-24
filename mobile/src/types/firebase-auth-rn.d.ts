// @firebase/auth's package.json "exports" map points "types" at its generic public
// .d.ts for every platform condition, so TypeScript never sees the React Native entry
// point (./dist/rn/index.rn.d.ts) even though Metro correctly resolves the RN JS build
// at runtime. This augmentation restores the one symbol from that RN entry point we use.
export {};

declare module '@firebase/auth' {
  export function getReactNativePersistence(
    storage: unknown
  ): import('@firebase/auth').Persistence;
}
