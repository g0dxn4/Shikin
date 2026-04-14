#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { tools, type ToolDefinition } from './tools.js'
import { close } from './database.js'
import { z } from 'zod'

function isFailureResult(value: unknown): value is Record<string, unknown> & { success: false } {
  return (
    typeof value === 'object' && value !== null && 'success' in value && value.success === false
  )
}

// Convert a Zod schema to commander options
export function zodToOptions(schema: z.ZodObject<any>): Array<{
  flag: string
  description: string
  required: boolean
  isArray: boolean
  isBoolean: boolean
  isStructured: boolean
  defaultValue?: unknown
}> {
  const shape = schema.shape
  const options: Array<{
    flag: string
    description: string
    required: boolean
    isArray: boolean
    isBoolean: boolean
    isStructured: boolean
    defaultValue?: unknown
  }> = []

  for (const [key, zodType] of Object.entries(shape)) {
    const { required, defaultValue } = getOptionWrapperMetadata(zodType as z.ZodTypeAny)
    const inner = unwrapSchema(zodType as z.ZodTypeAny)
    let isArray = false
    let isBoolean = false
    let isStructured = false

    // Check type
    if (inner instanceof z.ZodBoolean) {
      isBoolean = true
    } else if (inner instanceof z.ZodArray) {
      isArray = true
      isStructured = true
    } else if (inner instanceof z.ZodObject) {
      isStructured = true
    }

    const flag = key.replace(/([A-Z])/g, '-$1').toLowerCase() // camelCase → kebab-case
    const rawDesc = (inner as any)?.description || (zodType as any)?.description || ''
    const desc = isStructured
      ? `${rawDesc}${rawDesc ? ' ' : ''}Pass as JSON (example: '[{"key":"value"}]').`
      : rawDesc

    options.push({
      flag,
      description: desc,
      required,
      isArray,
      isBoolean,
      isStructured,
      defaultValue,
    })
  }

  return options
}

function getOptionWrapperMetadata(schema: z.ZodTypeAny): {
  required: boolean
  defaultValue?: unknown
} {
  let current = schema
  let required = true
  let defaultValue: unknown = undefined

  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    if (current instanceof z.ZodDefault) {
      defaultValue = current._def.defaultValue()
      required = false
      current = current._def.innerType
      continue
    }

    if (current instanceof z.ZodOptional) {
      required = false
    }

    current = current.unwrap()
  }

  return { required, defaultValue }
}

export function createProgram(toolDefinitions: ToolDefinition[] = tools): Command {
  const program = new Command()
    .name('shikin')
    .description('Shikin — control your finances from the command line')
    .version('0.1.0')

  // Register each tool as a CLI command
  for (const tool of toolDefinitions) {
    const cmd = program.command(tool.name).description(tool.description)

    const schemaShape = tool.schema.shape
    if (schemaShape && Object.keys(schemaShape).length > 0) {
      const options = zodToOptions(tool.schema)

      for (const opt of options) {
        const placeholder = opt.isStructured ? '<json>' : '<value>'
        const flagStr = opt.isBoolean ? `--${opt.flag}` : `--${opt.flag} ${placeholder}`

        if (opt.required) {
          cmd.requiredOption(flagStr, opt.description)
        } else {
          cmd.option(flagStr, opt.description, opt.defaultValue as string)
        }
      }
    }

    cmd.action(async (opts) => {
      try {
        // Convert CLI string values to proper types based on schema
        const input = coerceInput(opts, tool.schema)
        const parsed = tool.schema.parse(input)
        const result = await tool.execute(parsed)

        console.log(JSON.stringify(result, null, 2))

        if (isFailureResult(result)) {
          process.exitCode = 1
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          console.error(JSON.stringify({ error: 'Validation error', issues: err.issues }, null, 2))
        } else {
          console.error(
            JSON.stringify(
              {
                error: err instanceof Error ? err.message : String(err),
              },
              null,
              2
            )
          )
        }
        process.exitCode = 1
      } finally {
        close()
      }
    })
  }

  return program
}

const program = createProgram()

// Coerce string CLI inputs to proper types based on Zod schema
export function coerceInput(
  opts: Record<string, unknown>,
  schema: z.ZodObject<any>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const shape = schema.shape

  for (const [key, value] of Object.entries(opts)) {
    // Commander uses camelCase for options
    if (value === undefined) continue

    const zodType = shape[key] as z.ZodTypeAny | undefined
    if (!zodType) continue

    result[key] = coerceValue(value, zodType, key)
  }

  return result
}

function coerceValue(value: unknown, schema: z.ZodTypeAny, optionName = 'value'): unknown {
  const zodType = unwrapSchema(schema)

  if (zodType instanceof z.ZodNumber) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed === '' ? trimmed : Number(trimmed)
    }
    return value
  }

  if (zodType instanceof z.ZodBoolean) {
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true') return true
      if (normalized === 'false') return false
    }
    return value === true || value === 'true'
  }

  if (zodType instanceof z.ZodString) {
    return value
  }

  if (zodType instanceof z.ZodArray) {
    const structuredValue = parseStructuredValue(value, optionName)
    if (!Array.isArray(structuredValue)) return structuredValue
    return structuredValue.map((item) => coerceValue(item, zodType.element, optionName))
  }

  if (zodType instanceof z.ZodObject) {
    const structuredValue = parseStructuredValue(value, optionName)
    if (!structuredValue || typeof structuredValue !== 'object' || Array.isArray(structuredValue)) {
      return structuredValue
    }

    const objectShape = zodType.shape
    return Object.fromEntries(
      Object.entries(structuredValue).map(([key, nestedValue]) => [
        key,
        objectShape[key]
          ? coerceValue(nestedValue, objectShape[key] as z.ZodTypeAny, `${optionName}.${key}`)
          : nestedValue,
      ])
    )
  }

  return value
}

function parseStructuredValue(value: unknown, optionName: string): unknown {
  if (typeof value !== 'string') return value

  const trimmed = value.trim()
  const looksLikeJson =
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('{') && trimmed.endsWith('}'))

  if (!looksLikeJson) return value

  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error(
      `Invalid JSON for --${optionName.replace(/([A-Z])/g, '-$1').toLowerCase()}. Provide valid JSON for structured options.`
    )
  }
}

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema

  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    current = current instanceof z.ZodDefault ? current._def.innerType : current.unwrap()
  }

  return current
}

if (isDirectExecution()) {
  program.parse()
}

function isDirectExecution(): boolean {
  const entry = process.argv[1]
  return entry ? import.meta.url === pathToFileURL(entry).href : false
}
