#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
import { Command } from 'commander'
import { tools } from './tools.js'
import { close } from './database.js'
import { z } from 'zod'

const program = new Command()
  .name('shikin')
  .description('Shikin — control your finances from the command line')
  .version('0.1.0')

// Convert a Zod schema to commander options
function zodToOptions(schema: z.ZodObject<any>): Array<{
  flag: string
  description: string
  required: boolean
  isArray: boolean
  isBoolean: boolean
  defaultValue?: unknown
}> {
  const shape = schema.shape
  const options: Array<{
    flag: string
    description: string
    required: boolean
    isArray: boolean
    isBoolean: boolean
    defaultValue?: unknown
  }> = []

  for (const [key, zodType] of Object.entries(shape)) {
    let inner = zodType as z.ZodTypeAny
    let required = true
    let defaultValue: unknown = undefined
    let isArray = false
    let isBoolean = false

    // Unwrap optional
    if (inner instanceof z.ZodOptional) {
      required = false
      inner = inner.unwrap()
    }

    // Unwrap default
    if (inner instanceof z.ZodDefault) {
      defaultValue = inner._def.defaultValue()
      required = false
      inner = inner._def.innerType
    }

    // Check type
    if (inner instanceof z.ZodBoolean) {
      isBoolean = true
    } else if (inner instanceof z.ZodArray) {
      isArray = true
    }

    const flag = key.replace(/([A-Z])/g, '-$1').toLowerCase() // camelCase → kebab-case
    const desc = (inner as any)?.description || (zodType as any)?.description || ''

    options.push({
      flag,
      description: desc,
      required,
      isArray,
      isBoolean,
      defaultValue,
    })
  }

  return options
}

// Register each tool as a CLI command
for (const tool of tools) {
  const cmd = program.command(tool.name).description(tool.description)

  const schemaShape = tool.schema.shape
  if (schemaShape && Object.keys(schemaShape).length > 0) {
    const options = zodToOptions(tool.schema)

    for (const opt of options) {
      const flagStr = opt.isBoolean ? `--${opt.flag}` : `--${opt.flag} <value>`

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

// Coerce string CLI inputs to proper types based on Zod schema
function coerceInput(
  opts: Record<string, unknown>,
  schema: z.ZodObject<any>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const shape = schema.shape

  for (const [key, value] of Object.entries(opts)) {
    // Commander uses camelCase for options
    if (value === undefined) continue

    let zodType = shape[key] as z.ZodTypeAny | undefined
    if (!zodType) continue

    // Unwrap optional/default
    while (zodType instanceof z.ZodOptional || zodType instanceof z.ZodDefault) {
      zodType =
        zodType instanceof z.ZodOptional
          ? zodType.unwrap()
          : (zodType as z.ZodDefault<any>)._def.innerType
    }

    if (zodType instanceof z.ZodNumber && typeof value === 'string') {
      result[key] = Number(value)
    } else if (zodType instanceof z.ZodBoolean) {
      result[key] = value === true || value === 'true'
    } else {
      result[key] = value
    }
  }

  return result
}

program.parse()
