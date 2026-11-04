import {
  coerceConfigForSubmit,
  configFieldDisplayValue,
  findInvalidJsonField,
  findMissingRequiredField,
  isConfigValueMissing,
  RotationConfigField,
} from '@/utils/rotation'

const fields: RotationConfigField[] = [
  { id: 'models', label: 'Models', field_type: 'list', required: false },
  { id: 'max_budget', label: 'Max budget', field_type: 'int', required: false },
  { id: 'policies', label: 'Policies', field_type: 'json', required: false },
  { id: 'blocked', label: 'Blocked', field_type: 'bool', required: false },
  { id: 'project_id', label: 'Project', required: true, resource_type: 'project' },
]

describe('coerceConfigForSubmit', () => {
  test('splits list fields on commas and drops blanks', () => {
    expect(coerceConfigForSubmit({ models: ' gpt-4o, ,o3 ,' }, fields)).toEqual({
      models: ['gpt-4o', 'o3'],
    })
    expect(coerceConfigForSubmit({ models: '  ' }, fields)).toEqual({ models: [] })
  })

  test('parses numeric fields and omits empty ones', () => {
    expect(coerceConfigForSubmit({ max_budget: '12.5' }, fields)).toEqual({ max_budget: 12.5 })
    expect(coerceConfigForSubmit({ max_budget: ' ' }, fields)).toEqual({})
    expect(coerceConfigForSubmit({ max_budget: 'ten' }, fields)).toEqual({ max_budget: 'ten' })
  })

  test('parses json fields and keeps invalid input for the server to reject', () => {
    expect(coerceConfigForSubmit({ policies: '[{"effect": "allow"}]' }, fields)).toEqual({
      policies: [{ effect: 'allow' }],
    })
    expect(coerceConfigForSubmit({ policies: '' }, fields)).toEqual({})
    expect(coerceConfigForSubmit({ policies: '{nope' }, fields)).toEqual({ policies: '{nope' })
  })

  test('passes through typed values, strings and keys outside the schema', () => {
    const input = {
      models: ['a'],
      blocked: true,
      project_id: 'proj_1',
      metadata: { team: 'core' },
      name_template: 'phase-{id}',
    }
    expect(coerceConfigForSubmit(input, fields)).toEqual(input)
  })
})

describe('required and json validation', () => {
  test('treats blank strings and empty lists as missing', () => {
    expect(isConfigValueMissing(undefined)).toBe(true)
    expect(isConfigValueMissing(null)).toBe(true)
    expect(isConfigValueMissing('  ')).toBe(true)
    expect(isConfigValueMissing([])).toBe(true)
    expect(isConfigValueMissing(0)).toBe(false)
    expect(isConfigValueMissing(false)).toBe(false)
    expect(isConfigValueMissing(['a'])).toBe(false)
  })

  test('finds the first missing required field', () => {
    expect(findMissingRequiredField({}, fields)?.id).toBe('project_id')
    expect(findMissingRequiredField({ project_id: 'proj_1' }, fields)).toBeUndefined()
  })

  test('flags json fields that do not parse', () => {
    expect(findInvalidJsonField({ policies: '{nope' }, fields)?.id).toBe('policies')
    expect(findInvalidJsonField({ policies: '{"a": 1}' }, fields)).toBeUndefined()
    expect(findInvalidJsonField({ policies: { a: 1 } }, fields)).toBeUndefined()
  })
})

describe('configFieldDisplayValue', () => {
  test('renders lists, json and scalars for text inputs', () => {
    expect(configFieldDisplayValue(fields[0], ['a', 'b'])).toBe('a, b')
    expect(configFieldDisplayValue(fields[2], { a: 1 })).toBe('{\n  "a": 1\n}')
    expect(configFieldDisplayValue(fields[2], '{"a": 1}')).toBe('{"a": 1}')
    expect(configFieldDisplayValue(fields[1], 5)).toBe('5')
    expect(configFieldDisplayValue(fields[1], undefined)).toBe('')
  })
})
