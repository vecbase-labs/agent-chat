import { expect, test } from 'vitest'
import { avatarPng } from '../src/server/avatars'
import { avatarFixture } from './avatar-fixture'

test('PNG avatars reject corrupt containers and trailing payloads', () => {
  expect(avatarPng(avatarFixture)).toEqual(avatarFixture)
  const corrupted = Buffer.from(avatarFixture)
  corrupted[corrupted.length - 6] ^= 1
  expect(() => avatarPng(corrupted)).toThrow()
  expect(() =>
    avatarPng(Buffer.concat([avatarFixture, Buffer.from('<script/>')])),
  ).toThrow()
  expect(() => avatarPng(Buffer.from('<svg onload="alert(1)"/>'))).toThrow()
  expect(() => avatarPng(avatarFixture.subarray(0, 40))).toThrow()
})
