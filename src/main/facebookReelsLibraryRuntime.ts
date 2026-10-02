import { app } from 'electron'
import { join } from 'node:path'
import { FacebookReelsLibrary } from './facebookReelsLibrary'

let library: FacebookReelsLibrary | undefined
export function reelsDownloadLibrary(): FacebookReelsLibrary {
  return library ??= new FacebookReelsLibrary(join(app.getPath('userData'), 'facebook-reels-library'))
}
