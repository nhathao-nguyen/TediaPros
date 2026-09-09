export type AppRuntimeProfile = Readonly<{
  appName: string
  userDataDirectory: string
  windowTitle: string
}>

const PRODUCTION_PROFILE: AppRuntimeProfile = Object.freeze({
  appName: 'tedia-pros',
  userDataDirectory: 'tedia-pros',
  windowTitle: 'TediaPros'
})

const DEVELOPMENT_PROFILE: AppRuntimeProfile = Object.freeze({
  appName: 'tedia-pros-dev',
  userDataDirectory: 'tedia-pros-dev',
  windowTitle: 'TediaPros (Dev)'
})

/**
 * Keep the source-run app isolated from the installed app. Electron uses the
 * app name for its single-instance identity, while the explicit userData path
 * separates credentials, caches, logs, checkpoints and downloaded runtimes.
 */
export function resolveAppRuntimeProfile(isPackaged: boolean): AppRuntimeProfile {
  return isPackaged ? PRODUCTION_PROFILE : DEVELOPMENT_PROFILE
}
