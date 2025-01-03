import { getSecret } from '@/utils/secretConfig'
import fs from 'fs'
import path from 'path'

// Mock fs module
jest.mock('fs')
const mockedFs = jest.mocked(fs)

describe('getSecret', () => {
  // Save original env and reset between tests
  const originalEnv = process.env

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv }
    // Clear all mocks
    jest.clearAllMocks()
    // Reset console.debug mock
    jest.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterAll(() => {
    // Restore original env after all tests
    process.env = originalEnv
  })

  test('retrieves secret from environment variable', () => {
    process.env.TEST_SECRET = 'env_secret_value'
    
    expect(getSecret('TEST_SECRET')).toBe('env_secret_value')
  })

  test('retrieves secret from file when _FILE env var is set', () => {
    process.env.TEST_SECRET_FILE = '/path/to/secret'
    mockedFs.readFileSync.mockReturnValue('file_secret_value')

    expect(getSecret('TEST_SECRET')).toBe('file_secret_value')
    expect(mockedFs.readFileSync).toHaveBeenCalledWith('/path/to/secret', 'utf8')
  })

  test('file-based secret takes priority over environment variable', () => {
    process.env.TEST_SECRET = 'env_secret_value'
    process.env.TEST_SECRET_FILE = '/path/to/secret'
    mockedFs.readFileSync.mockReturnValue('file_secret_value')

    expect(getSecret('TEST_SECRET')).toBe('file_secret_value')
  })

  test('falls back to env var when file does not exist', () => {
    process.env.TEST_SECRET = 'env_secret_value'
    process.env.TEST_SECRET_FILE = '/nonexistent/path'
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory')
    })

    expect(getSecret('TEST_SECRET')).toBe('env_secret_value')
  })

  test('returns empty string when neither file nor env var exists', () => {
    expect(getSecret('TEST_SECRET')).toBe('')
  })

  test('handles empty secret file', () => {
    process.env.TEST_SECRET_FILE = '/path/to/empty'
    mockedFs.readFileSync.mockReturnValue('')

    expect(getSecret('TEST_SECRET')).toBe('')
  })

  test('trims whitespace from file content', () => {
    process.env.TEST_SECRET_FILE = '/path/to/secret'
    mockedFs.readFileSync.mockReturnValue('  secret_value_with_spaces  \n')

    expect(getSecret('TEST_SECRET')).toBe('secret_value_with_spaces')
  })

  describe('debug logging', () => {
    beforeEach(() => {
      process.env.DEBUG = 'True'
    })

    test('logs when secret is successfully loaded from file', () => {
      const consoleSpy = jest.spyOn(console, 'debug')
      process.env.TEST_SECRET_FILE = '/path/to/secret'
      mockedFs.readFileSync.mockReturnValue('file_secret_value')

      getSecret('TEST_SECRET')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Loaded secret 'TEST_SECRET' from file: /path/to/secret")
      )
    })

    test('logs when secret file is not found', () => {
      const consoleSpy = jest.spyOn(console, 'debug')
      process.env.TEST_SECRET_FILE = '/nonexistent/path'
      mockedFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory')
      })

      getSecret('TEST_SECRET')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read secret file for 'TEST_SECRET'")
      )
    })

    test('logs when secret is loaded from environment variable', () => {
      const consoleSpy = jest.spyOn(console, 'debug')
      process.env.TEST_SECRET = 'env_secret_value'

      getSecret('TEST_SECRET')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Loaded secret 'TEST_SECRET' from environment variable")
      )
    })

    test('logs when secret is not found anywhere', () => {
      const consoleSpy = jest.spyOn(console, 'debug')

      getSecret('TEST_SECRET')

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Secret 'TEST_SECRET' not found in environment or file")
      )
    })
  })

  test('handles file read permission error', () => {
    process.env.TEST_SECRET_FILE = '/path/to/secret'
    process.env.TEST_SECRET = 'fallback_value'
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    expect(getSecret('TEST_SECRET')).toBe('fallback_value')
  })
})
