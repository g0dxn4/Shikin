# Private ChatGPT connection for an existing Shikin Docker container

This optional macOS helper connects the **already installed** Shikin MCP server
inside a running Docker container to ChatGPT through OpenAI Secure MCP Tunnel.
It does not install a new Shikin version, migrate the deployment, create another
database, modify Compose, or publish a web port. Your existing Tailscale Serve
configuration can remain private.

## How it works

The official `tunnel-client` runs on the Mac and makes outbound HTTPS requests to
OpenAI. Its stdio command runs `docker exec -i` in the existing Shikin container,
using that container's installed Node/MCP runtime and existing data directory.
Requests execute there; responses return to ChatGPT. The requested data therefore
leaves the Mac even though the database and server remain private.

Docker retains responsibility for starting Shikin (`restart: unless-stopped`,
for example). A separate macOS LaunchAgent starts **only the tunnel** at login,
restarts it if it exits, and retries after Docker/container startup failures.
No Docker socket is mounted into another container.

This is login startup, not startup before login. A reboot with FileVault locked,
logout, sleep, stopped Docker, or lost connectivity can interrupt access. Docker
must start for the same macOS user and use the same Docker context as during
setup. A GUI login session is required to load the LaunchAgent; SSH alone does
not create one. Once that user's GUI session is running, setup can be run over SSH.

## Prerequisites

1. Confirm your existing container and mounted database. The helper defaults are
   for this deployment layout; pass overrides if yours differs:

   | Setting   | Default inside Docker                          |
   | --------- | ---------------------------------------------- |
   | Container | `shikin-web`                                   |
   | Node      | `/opt/shikin-cli/runtime/bin/node`             |
   | MCP       | `/opt/shikin-cli/dist/mcp-server.js`           |
   | App data  | `/opt/shikin-home/.local/share/com.asf.shikin` |

   The app-data mount must already contain a nonempty `shikin.db`. Both setup
   and each MCP launch refuse to proceed if it is missing. The helper pins
   `XDG_DATA_HOME` to this directory's parent and disables legacy-data relocation.
   It uses your installed CLI version; updating this Git checkout does not update
   your container's CLI bundle or change the database schema.

2. In [OpenAI Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels),
   create or reuse a tunnel associated with the intended personal account/workspace.
   Creating a tunnel needs Tunnels Read + Manage. Its runtime principal and
   plugin operator need Tunnels Read + Use. Availability and ChatGPT custom-MCP
   permissions must be checked in your account; this helper cannot grant them or
   bypass plan limits. Create a **runtime** API key, not an organization admin key.

   OpenAI's currently documented ChatGPT custom-MCP limits (they can change):
   [Creating custom MCP apps in ChatGPT](https://help.openai.com/en/articles/12584461-creating-custom-mcp-apps-in-chatgpt)
   says Pro users can build apps using the Apps SDK; full MCP is only available to
   Business and Enterprise/Edu users, currently; Pro users can connect custom MCP
   servers with read/fetch permissions. That is not a claim that every Pro tunnel
   is unsupported. Confirm the supported workspace permissions in your account.
   OpenAI's [custom MCP server guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
   treats a missing `readOnlyHint` as a write.

3. Install the official client on the **Mac host**, using the supported Homebrew path:

   ```bash
   brew install openai/tools/tunnel-client
   tunnel-client --version
   tunnel-client help quickstart
   ```

   See [the official installation instructions](https://github.com/openai/tunnel-client#install-with-homebrew)
   and [current releases](https://github.com/openai/tunnel-client/releases/latest).
   Do not bypass macOS security checks for a manually downloaded binary.

## Install and start

From your Shikin checkout, as the user who runs Docker (no `sudo`):

```bash
bash scripts/shikin-chatgpt-tunnel.sh setup --tunnel-id YOUR_FULL_TUNNEL_ID
```

Replace the placeholder with the exact ID from Platform, preserving any namespace.
Enter the runtime API key at the hidden prompt. Do not put it in Git or chat.
For a key already stored securely on disk, `--key-file /absolute/path/to/key`
copies it locally without putting its contents in command arguments.

Setup installs a self-contained copy of the helper, a profile and a mode-0600
runtime-key file under:

`~/Library/Application Support/com.asf.shikin/chatgpt-tunnel/`

The directory is mode 0700. This is a local plaintext secret file protected by
filesystem permissions, not a Keychain item. The profile only contains its
`file:` reference. The LaunchAgent contains no secret. Keep this directory out
of shared folders and Git. The API key authenticates the tunnel; it is not
passed into the Shikin container.

The LaunchAgent is installed at:

`~/Library/LaunchAgents/com.asf.shikin.chatgpt-tunnel.plist`

The helper retains absolute executable paths, so normal login does not need the
interactive shell's PATH. The Docker CLI uses your default context. If you depend
on a shell-only `DOCKER_HOST` or `DOCKER_CONTEXT` override, configure the equivalent
default context before setup. The helper does not copy unrelated environment
variables or credentials from your shell into the service.

Setup starts the service, but **service registration is not proof of tunnel or
ChatGPT access**. Check both:

```bash
bash scripts/shikin-chatgpt-tunnel.sh status
bash scripts/shikin-chatgpt-tunnel.sh doctor
```

`status` checks the service plus `/readyz` on a dynamically chosen loopback port.
It prints the local admin UI URL when ready. `doctor` runs the official client's
diagnostics. With SSH, a `127.0.0.1` admin URL refers to the Mac; use the local
browser or an SSH port forward to view it. Do not publish that admin port.

## Connect ChatGPT and verify

In [ChatGPT Plugins](https://chatgpt.com/plugins), use **Add custom MCP server →
Connection: Tunnel**, select this tunnel and configure the applicable
authentication. The runtime API key belongs to the local tunnel client; do not
paste it into the plugin authentication form. Then create/install the private
plugin and verify its discovered tool list.

This forwards the installed Shikin MCP catalog, **including write tools**; it is
not a read-only filter. Apply the desired tool permissions and confirmation
settings in ChatGPT. Missing Shikin `effects` annotations do not mean read-only.
OpenAI treats a missing `readOnlyHint` as a write.

`list-accounts` is annotated read-only in this checkout (`effects.readOnly` and
MCP `readOnlyHint: true`). The helper uses the **installed container bundle**, so
updating this Git checkout does not change the annotations ChatGPT discovers.
Verify the actual discovered `list-accounts` `readOnlyHint` in the plugin tool
list. If you need the annotation live, update the installed bundle through the
normal reviewed deployment path; this helper does not build or replace it.

First make a read request such as listing accounts. Confirm it returns the
expected existing accounts and currencies. Only then consider the connection
verified. Do not test connectivity by inserting a real transaction. Live
verification requires an actual Mac and a successful ChatGPT safe read.

Secure MCP Tunnel supports private connections. Public plugin distribution has
different endpoint requirements; this helper does not publish a directory plugin.

## Manage the service

Run these from the checkout, or replace the script path with the quoted installed
copy if the checkout is moved or removed:

```bash
bash scripts/shikin-chatgpt-tunnel.sh check
bash scripts/shikin-chatgpt-tunnel.sh logs
bash scripts/shikin-chatgpt-tunnel.sh stop
bash scripts/shikin-chatgpt-tunnel.sh start
bash scripts/shikin-chatgpt-tunnel.sh uninstall
```

- `check`: Docker and file checks only; does not start MCP or call finance tools.
- `stop`: stops the tunnel and disables its login startup until `start` is run.
- `uninstall`: removes **this state directory's** claimed tunnel files and copied
  runtime key only. It preserves Shikin, Docker volumes, the original `--key-file`
  source, unrelated files, and any LaunchAgent that is not associated with this
  state directory. A rejected setup that never claimed ownership is non-destructive:
  `uninstall` refuses to disable/unload the shared service or delete pre-existing
  files. Do not use uninstall as a generic cleanup of another installation's files.
  Revoke the key in Platform separately if it is no longer needed.
- Reconfiguration/helper updates: uninstall this helper, then run setup from the
  new checkout. Do not run multiple tunnel clients unintentionally for one setup.
- If setup fails after it has claimed this state directory, inspect the error, run
  `uninstall` for **that same** `--state-dir`, and retry. An existing helper/service
  is never silently overwritten, and uninstall will not stop a service owned by a
  different state directory.

Troubleshooting: check that Docker and `shikin-web` are running; verify the three
container paths; run `doctor` for tunnel permission/association errors. The
LaunchAgent retries at a throttled interval while Docker is unavailable. `logs`
shows the last 60 lines, but the underlying local log can grow; monitor its size.
Do not publish unredacted logs or tool results containing financial data.

## References and validation

- [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [Connect and test a plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [Official tunnel-client onboarding](https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md)

The helper tests exercise setup, private credential handling, quoting, XML,
stdio forwarding, database guards, startup failures, readiness, ownership-safe
cleanup and mocked Docker/macOS commands. They do not prove macOS service
operation or OpenAI account access. Set `SHIKIN_TEST_REAL_CLIENT` to an installed
official tunnel-client binary to validate profile generation against its actual
CLI while keeping other service calls mocked. Live verification requires the Mac
and a successful ChatGPT safe read; this helper does not authenticate to OpenAI.
