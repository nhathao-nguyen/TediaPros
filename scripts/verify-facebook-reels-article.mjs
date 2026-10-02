// Developer verification of a public linked article and its XLSX/TXT artifacts.
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, basename } from 'node:path'

const [url,outputRoot,reelId]=process.argv.slice(2)
if(!url||!outputRoot||!isAbsolute(outputRoot)||!/^\d{5,30}$/.test(reelId??''))throw Error('Usage: node scripts/verify-facebook-reels-article.mjs HTTPS_URL ABSOLUTE_OUTPUT_ROOT REEL_ID')
const repo=process.cwd(),require=createRequire(join(repo,'package.json'))
const temp=await mkdtemp(join(tmpdir(),'tedia-article-verification-')),modulePath=join(temp,'article.cjs')
try {
  await build({stdin:{contents:`export { fetchArticle } from './src/main/facebookArticle'; export { exportFacebookReels } from './src/main/facebookReelsExporter'; export { facebookReelEntry } from './src/shared/facebookReels';`,resolveDir:repo},
    bundle:true,platform:'node',format:'cjs',target:'node20',outfile:modulePath,
    plugins:[{name:'runtime-dependencies',setup(builder){builder.onResolve({filter:/^(?:jsdom|exceljs|@mozilla\/readability)$/},args=>({path:require.resolve(args.path),external:true}))}}]})
  const {fetchArticle,exportFacebookReels,facebookReelEntry}=require(modulePath)
  const controller=new AbortController(),article=await fetchArticle(url,controller.signal)
  if(article.status!=='success')throw Error(article.error||'No article extracted')
  await mkdir(outputRoot,{recursive:true})
  const entry=facebookReelEntry(reelId,'Article extraction verification sample','graphql')
  entry.facebook.links=[{url,foundIn:'comment'}]
  const result=await exportFacebookReels([entry],{outputRoot,downloadVideos:false},controller.signal,{
    resolve:async e=>e,article:async()=>article,video:async()=>{throw Error('disabled')}
  })
  console.log(JSON.stringify({articleTitle:article.title,characters:article.content.length,paragraphs:article.content.split(/\n\n/).length,
    articlePath:result.rows[0].articlePath,excelPath:result.excelPath,manifestPath:result.manifestPath},null,2))
}finally{
  if(dirname(resolve(temp))!==resolve(tmpdir())||!basename(temp).startsWith('tedia-article-verification-'))throw Error('Unsafe scratch directory')
  await rm(temp,{recursive:true,force:true})
}
