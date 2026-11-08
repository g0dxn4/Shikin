import { startDataServer } from './data-server-runtime.mjs'

// The direct bridge deliberately retains its permissive parser and import-to-start
// contract; the CLI validates its own port before calling the inert runtime.
const PORT_ENV = process.env.SHIKIN_DATA_SERVER_PORT
const parsedPort = Number.parseInt(PORT_ENV || '', 10)
const PORT =
  Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 1480
const HOSTED_MODE = process.env.SHIKIN_WEB_HOSTED === '1'
const STATIC_ROOT = HOSTED_MODE ? process.env.SHIKIN_WEB_STATIC_ROOT : null

startDataServer({
  port: PORT,
  hostedMode: HOSTED_MODE,
  staticRoot: STATIC_ROOT,
  storageEnvironment: process.env,
})
