# GrayMatter Local Server

GrayMatter Local Server is a downloadable, executable starter for private agent memory.

It runs a minimum Spring Boot server on your machine with:

- RBAC-backed login through Spring Security
- `Principal` identity records
- `UserPreferences` for local user state
- `MemoryEntry` create/query APIs through `/v1/MemoryEntry/*`
- Data Workbooks through the `/v1/Workbook` API
- an embedded Valkyr Labs-branded dashboard at `http://localhost:8787`
- a Cloud activation bridge at `/v1/graymatter/activation/bridge`
- a local GrayMatter SWARM v0.1 light-node adapter at `/v1/swarm-ops/graph`
- a ValkyrAI app-factory `application-bundle` with ThorAPI FEBE inputs
- H2 file storage under the user-local GrayMatter app data directory
- a Maven native profile for GraalVM/Spring Native builds

## Run

Set local admin credentials before launch:

```bash
export GRAYMATTER_ADMIN_USERNAME=admin
read -rsp "GrayMatter admin password: " GRAYMATTER_ADMIN_PASSWORD
export GRAYMATTER_ADMIN_PASSWORD
bin/graymatter-local-server
```

## Build from source

```bash
cd source
./mvnw package
```

If the archive includes `lib/graymatter-local-server.jar`, the launcher runs it directly.
Otherwise it builds from `source` with local Maven or the Maven wrapper.

## Promote / Synchronize

The dashboard button calls `POST /v1/graymatter/activation/bridge/event`.
This prepares a promotion payload and reports the local bundle, memory, workbook,
and Swarm Protocol state. It does not claim hosted synchronization completed
unless the operator supplies hosted auth such as `VALKYR_AUTH_TOKEN`.

Swarm Protocol status is exposed locally at:

```bash
curl -u "admin:$GRAYMATTER_ADMIN_PASSWORD" http://localhost:8787/v1/swarm-ops/graph
```

## Native build

With GraalVM native-image installed:

```bash
cd source
./mvnw -Pnative native:compile
```
