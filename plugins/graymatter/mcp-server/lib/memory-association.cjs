'use strict';

const { createHash } = require('node:crypto');

const path = 'graymatter/memory/associations';
const capability = Object.freeze({
  contractVersion: 'graymatter-memory-association/v1', supported: true,
  semantics: 'record-identity-navigation', tupleHashAlgorithm: 'sha256-length-prefixed-utf8/v1',
  cascadeDelete: true, maxRelationCodePoints: 128, maxRelationUtf8Bytes: 512
});
const receiptFields = ['contractVersion', 'status', 'associationRef', 'fromId', 'toId', 'relation', 'tupleHash', 'recordedAt', 'replayed'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const invalidRelation = /^[\p{White_Space}]|[\p{White_Space}]$|[\p{Cc}\p{Cs}]/u;
const failures = {
  INVALID_MEMORY_LINK: 'Supply two distinct memory UUIDs and an exact valid relation.',
  MEMORY_LINK_PROFILE_REQUIRED: 'Select one authenticated private profile. Use local Basic credentials on loopback or a bearer session over HTTPS.',
  MEMORY_LINK_UNSUPPORTED: 'This backend does not advertise the required memory association contract. No write was sent.',
  MEMORY_LINK_CAPABILITY_UNVERIFIED: 'Memory association support could not be verified. No write was sent.',
  MEMORY_LINK_UNVERIFIED: 'The association outcome could not be verified. Check the selected backend before retrying.'
};

function failure(code) {
  return Object.assign(new Error(failures[code]), { code });
}

function exactKeys(value, fields) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function prepare(input) {
  let args;
  try {
    if (input === null || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (!exactKeys(descriptors, ['fromId', 'toId', 'relation']) || Object.getOwnPropertySymbols(input).length) throw new Error();
    args = {};
    for (const field of ['fromId', 'toId', 'relation']) {
      if (!Object.hasOwn(descriptors[field], 'value') || !descriptors[field].enumerable) throw new Error();
      args[field] = descriptors[field].value;
    }
  } catch { throw failure('INVALID_MEMORY_LINK'); }
  if (!exactKeys(args, ['fromId', 'toId', 'relation'])
      || typeof args.fromId !== 'string' || !uuid.test(args.fromId)
      || typeof args.toId !== 'string' || !uuid.test(args.toId)
      || args.fromId.toLowerCase() === args.toId.toLowerCase()
      || typeof args.relation !== 'string' || !args.relation.length || args.relation.length > 256
      || [...args.relation].length > 128 || Buffer.byteLength(args.relation) > 512 || invalidRelation.test(args.relation)) {
    throw failure('INVALID_MEMORY_LINK');
  }
  return {fromId: args.fromId.toLowerCase(), toId: args.toId.toLowerCase(), relation: args.relation};
}

function tupleHash(input) {
  const hash = createHash('sha256');
  for (const field of [capability.contractVersion, input.fromId, input.toId, input.relation]) {
    const bytes = Buffer.from(field, 'utf8');
    const size = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length);
    hash.update(size).update(bytes);
  }
  return hash.digest('hex');
}

function validProfile(context) {
  if (context.publicApp || context.profileMode !== 'single') return false;
  try {
    const url = new URL(context.apiBase);
    if (url.username || url.password || url.search || url.hash) return false;
    if (context.token) return url.protocol === 'https:';
    return !context.requestScopedToken && Boolean(context.lightPassword)
      && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

// JSON.parse discards duplicate keys. Inspect decoded member names, including escaped spellings,
// after the normal parser has validated JSON syntax. String values never count as member names.
function requireUniqueKeys(raw) {
  const scopes = [];
  for (const token of raw.matchAll(/("(?:[^"\\]|\\.)*")(\s*:)?|[{}]/gu)) {
    if (token[0] === '{') scopes.push(new Set());
    else if (token[0] === '}') scopes.pop();
    else if (token[2]) {
      const key = JSON.parse(token[1]);
      const fields = scopes.at(-1);
      if (fields.has(key)) throw failure('INVALID_MEMORY_LINK');
      fields.add(key);
    }
  }
}

async function readResponse(response, requestUrl) {
  if (!response.ok) {
    await response.body?.cancel();
    return '';
  }
  if (response.redirected || (response.url && response.url !== requestUrl)
      || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new Error('Invalid association response');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new Error('Oversized association response');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const raw = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
  JSON.parse(raw);
  requireUniqueKeys(raw);
  return raw;
}

function timestamp(value) {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(value);
  if (!parts) return false;
  const [year, month, day] = parts.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day >= 1 && day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function verifiedReceipt(value, input, digest, replayed) {
  return exactKeys(value, receiptFields) && value.contractVersion === capability.contractVersion && value.status === 'recorded'
    && typeof value.associationRef === 'string' && uuid.test(value.associationRef) && value.associationRef === value.associationRef.toLowerCase()
    && value.fromId === input.fromId && value.toId === input.toId && value.relation === input.relation
    && value.tupleHash === digest && timestamp(value.recordedAt) && value.replayed === replayed;
}

async function record(args, context, request) {
  const input = prepare(args);
  if (!validProfile(context)) throw failure('MEMORY_LINK_PROFILE_REQUIRED');
  let support;
  try { support = await request('GET', path + '/capabilities'); }
  catch (error) {
    throw failure([404, 405, 501].includes(error.status) ? 'MEMORY_LINK_UNSUPPORTED' : 'MEMORY_LINK_CAPABILITY_UNVERIFIED');
  }
  if (support.status !== 200 || !exactKeys(support.body, Object.keys(capability))
      || !Object.entries(capability).every(([key, value]) => support.body[key] === value)) {
    const unsupported = support.status === 200 && (support.body?.supported === false
      || (typeof support.body?.contractVersion === 'string' && support.body.contractVersion !== capability.contractVersion));
    throw failure(unsupported ? 'MEMORY_LINK_UNSUPPORTED' : 'MEMORY_LINK_CAPABILITY_UNVERIFIED');
  }
  const digest = tupleHash(input);
  try {
    const post = await request('POST', path, input);
    if (![200, 201].includes(post.status) || !verifiedReceipt(post.body, input, digest, post.status === 200)) throw new Error();
    const get = await request('GET', path + '/' + post.body.associationRef);
    if (get.status !== 200 || !verifiedReceipt(get.body, input, digest, true)
        || get.body.associationRef !== post.body.associationRef || get.body.recordedAt !== post.body.recordedAt) throw new Error();
    return {...post.body, status: 'linked'};
  } catch { throw failure('MEMORY_LINK_UNVERIFIED'); }
}

function safeFailure(error) {
  let code;
  try { code = Object.getOwnPropertyDescriptor(error, 'code')?.value; } catch { /* Unknown failures stay bounded. */ }
  return failure(typeof code === 'string' && Object.hasOwn(failures, code) ? code : 'MEMORY_LINK_UNVERIFIED');
}

const recallPolicy = 'graymatter-association-recall/v1';
const recallFields = ['associationRef', 'anchorId', 'memoryId', 'associationHash', 'anchorSourceHash', 'sourceHash'];
const sha256 = /^[0-9a-f]{64}$/;

function recallOption(value) {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('includeAssociations must be a boolean.');
  return value === true ? {includeAssociations: true} : {};
}

function verifyRecall(request, result) {
  if (request.includeAssociations !== true) return result;
  const receipt = result?.receipt ?? result?.retrievalReceipt ?? result;
  const refs = receipt?.associationRefs;
  if (receipt?.associationPolicyVersion !== recallPolicy || typeof receipt.associationTruncated !== 'boolean'
      || !Array.isArray(refs) || refs.length > 8
      || refs.some(ref => !exactKeys(ref, recallFields)
        || ['associationRef', 'anchorId', 'memoryId'].some(key => typeof ref[key] !== 'string' || !uuid.test(ref[key]))
        || ref.anchorId.toLowerCase() === ref.memoryId.toLowerCase()
        || ['associationHash', 'anchorSourceHash', 'sourceHash'].some(key => typeof ref[key] !== 'string' || !sha256.test(ref[key])))
      || new Set(refs.map(ref => ref.memoryId.toLowerCase())).size !== refs.length) {
    throw new Error('The backend did not confirm the requested association recall contract.');
  }
  return result;
}

module.exports = { record, readResponse, requireUniqueKeys, safeFailure, recallOption, verifyRecall };
