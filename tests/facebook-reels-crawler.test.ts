import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isFacebookReelsTabUrl } from '../src/main/facebookReels'

test('isFacebookReelsTabUrl matches profile reels tab URLs', () => {
  assert.equal(
    isFacebookReelsTabUrl('https://www.facebook.com/profile.php?id=61580381841572&sk=reels_tab'),
    true
  )
  assert.equal(
    isFacebookReelsTabUrl(
      'https://facebook.com/profile.php?id=1000123456&sk=reels_tab&mibextid=ZbWKwL'
    ),
    true
  )
  assert.equal(
    isFacebookReelsTabUrl('https://www.facebook.com/profile.php?id=1000123456&sk=reels'),
    true
  )
})

test('isFacebookReelsTabUrl matches fanpage and username reels tabs', () => {
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/TheBeatVietnam/reels/'), true)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/TheBeatVietnam/reels'), true)
  assert.equal(isFacebookReelsTabUrl('https://facebook.com/someone.cool/reels/'), true)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/reels/'), true)
})

test('isFacebookReelsTabUrl does not match single reel or video URLs', () => {
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/reel/123456789012345'), false)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/reel/123456789012345/'), false)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/watch/?v=123456789'), false)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/photo.php?fbid=123456'), false)
  assert.equal(isFacebookReelsTabUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false)
  assert.equal(isFacebookReelsTabUrl('invalid-url'), false)
})
