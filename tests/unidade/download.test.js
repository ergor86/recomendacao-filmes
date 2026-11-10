import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md5Hex, conferirMd5, extrairMd5 } from '../../src/dados/download.js';

test('md5Hex de "abc"', () => assert.equal(md5Hex(Buffer.from('abc')), '900150983cd24fb0d6963f7d28e17f72'));
test('conferirMd5 rejeita divergência', () => assert.throws(() => conferirMd5(Buffer.from('abc'), '0'.repeat(32)), /MD5 não confere/));
test('extrairMd5 aceita "MD5 (arquivo) = <hash>" e "<hash>  arquivo"', () => {
  assert.equal(extrairMd5('MD5 (ml-100k.zip) = 0e33842e24a9c977be4e0107933c0723'), '0e33842e24a9c977be4e0107933c0723');
  assert.equal(extrairMd5('0e33842e24a9c977be4e0107933c0723  ml-100k.zip'), '0e33842e24a9c977be4e0107933c0723');
});
