'use strict';
const { plainRequest, MAX_REQUEST_BYTES } = require('./procedure-execution.cjs');
const { projectProcedure } = require('./procedure-discovery.cjs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REFERENCE = /^[a-z0-9][a-z0-9._:/-]{0,127}$/iu;
const SOURCE = 'Procedure.metadataJson.procedureContract';

function inspectionError(code) {
  return Object.assign(new Error(code === 'INVALID_INSPECTION_INPUT'
    ? 'Provide one Procedure UUID returned by authorized discovery.'
    : 'The exact Procedure contract could not be verified. Check authentication, access and the ID; no execution authority was inferred.'), { code });
}

function own(row, key) {
  const descriptor = Object.getOwnPropertyDescriptor(row, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) throw Error('Invalid selected field');
  return descriptor.value;
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const reference = value => typeof value === 'string' && REFERENCE.test(value);
const unavailable = reason => ({ status: 'unavailable', source: SOURCE, reason });

// This is a bounded projection of existing declarations, not a second schema,
// eligibility evaluator, policy parser or substitute for server validation.
function inputContract(metadata) {
  if (metadata == null || metadata === '') return unavailable('metadata_missing');
  if (typeof metadata !== 'string') return unavailable('metadata_invalid');
  if (Buffer.byteLength(metadata) > MAX_REQUEST_BYTES) return unavailable('metadata_limit');
  let parsed;
  try { parsed = plainRequest(JSON.parse(metadata)); }
  catch { return unavailable('metadata_invalid_or_unprojectable'); }
  if (!object(parsed)) return unavailable('metadata_invalid');
  const declaration = parsed.procedureContract;
  if (declaration == null) return unavailable('contract_missing');
  if (!object(declaration)) return unavailable('declarations_invalid');
  if (declaration.version !== 1) return unavailable('unsupported_version');
  const required = declaration.requiredInputKeys ?? [];
  if (!Array.isArray(required) || required.length > 50 || !required.every(reference)) return unavailable('declarations_unprojectable');
  const projection = { version: 1, requiredInputKeys: [...new Set(required)] };
  for (const key of ['inputTypes', 'inputAliases', 'objectReferences']) {
    const mapping = declaration[key] ?? {};
    if (!object(mapping) || Object.keys(mapping).length > 50) return unavailable('declarations_unprojectable');
    for (const [name, value] of Object.entries(mapping)) {
      if (!reference(name) || (key === 'inputAliases'
        ? !Array.isArray(value) || value.length > 20 || !value.every(reference)
        : !reference(value))) return unavailable('declarations_unprojectable');
    }
    projection[key] = mapping;
  }
  return { status: 'available', source: SOURCE, projection };
}

async function inspectProcedure(request, procedureId) {
  if (typeof procedureId !== 'string' || !UUID.test(procedureId)) throw inspectionError('INVALID_INSPECTION_INPUT');
  const id = procedureId.toLowerCase();
  try {
    const row = await request('GET', `/Procedure/${id}`, undefined,
      { timeoutMs: 15000, readStatus: true, expectedStatus: 200 });
    const procedure = projectProcedure(row).summary;
    if (procedure.id !== id) throw Error('Wrong Procedure identity');
    const receipt = own(row, 'mechanizationReceiptRef');
    if (receipt != null && !reference(receipt)) throw Error('Invalid receipt reference');
    procedure.mechanizationReceiptRef = receipt ?? null;
    return { contractVersion: 'graymatter-procedure-inspection/v1', operation: 'inspect', procedure,
      inputContract: inputContract(own(row, 'metadataJson')), executionAuthorization: 'server_recheck_required',
      workflowVersionValidation: 'not_checked', launchInputSchema: { status: 'not_retrieved' } };
  } catch { throw inspectionError('PROCEDURE_INSPECTION_UNAVAILABLE'); }
}

module.exports = { inspectProcedure, inspectionError };
