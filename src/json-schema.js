const SCHEMA_FILES = {
  manifest: 'conference-manifest.schema.json',
  conference: 'conference.schema.json',
  programme: 'programme.schema.json',
  people: 'people.schema.json',
  locations: 'locations.schema.json',
  branding: 'branding.schema.json'
};

function typeMatches(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'null') return value === null;
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return typeof value === type;
}

export function validateJsonSchema(value, schema, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  const types = schema.type == null ? [] : (Array.isArray(schema.type) ? schema.type : [schema.type]);
  if (types.length && !types.some(type => typeMatches(value, type))) {
    errors.push(`${path}: expected ${types.join(' or ')}`);
    return errors;
  }

  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: string is too short`);
    if (schema.pattern) {
      try { if (!(new RegExp(schema.pattern)).test(value)) errors.push(`${path}: does not match required pattern`); }
      catch { errors.push(`${path}: schema has invalid pattern`); }
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: requires at least ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: allows at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateJsonSchema(item, schema.items, `${path}[${index}]`)));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (key in value) errors.push(...validateJsonSchema(value[key], childSchema, `${path}.${key}`));
    }
  }
  return errors;
}

let schemaPromise = null;
async function loadSchemas() {
  if (!schemaPromise) {
    schemaPromise = Promise.all(Object.entries(SCHEMA_FILES).map(async ([key, file]) => {
      const response = await fetch(new URL(`../schemas/${file}`, import.meta.url), {cache:'force-cache'});
      if (!response.ok) throw new Error(`Could not load runtime schema ${file}: HTTP ${response.status}`);
      return [key, await response.json()];
    })).then(entries => Object.fromEntries(entries));
  }
  return schemaPromise;
}

export async function validatePackageSchemas(pkg) {
  const schemas = await loadSchemas();
  const values = {
    manifest: pkg.manifest,
    conference: pkg.conference,
    programme: pkg.programme,
    people: pkg.people,
    locations: pkg.locations,
    branding: pkg.branding
  };
  const errors = [];
  for (const [key, value] of Object.entries(values)) {
    errors.push(...validateJsonSchema(value, schemas[key], key));
  }
  return errors;
}
